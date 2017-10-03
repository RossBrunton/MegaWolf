"use strict";

import {Ram, BusBanker, NullComponent} from "./basicComponents.js";
import {Component, MemoryBus} from "./busses.js";

const MSG_START = 0;
const MSG_STOP = 1;
const MSG_INIT = 2;
const MSG_RESET = 3;
const MSG_FRAME = 4;
const MSG_NEWROM = 5;

// Bus release/acquire
const MSG_RELEASE = 6;
const MSG_RELEASE_ACK = 7;
const MSG_ACQUIRE = 8;
const MSG_ACQUIRE_ACK = 9;

const MSG_DOIO = 10;

const SHM_IO = 0;
const SHM_DATA = 1;
const SHM_ADDR = 2;
const SHM_BANK = 3; // Memory bank, converted such that it can just be ORed with the access
const SHM_INT = 4; // Interrupt

// Memory bus: SHM_IO is set by the worker depending on the operation, which is then cleared by the main Z80 class
// These are always z80 addresses, and always 8 bit read/writes
const MEM_NONE = 0;
const MEM_READ = 1;
const MEM_WRITE = 2;
const MEM_IOREAD = 3;
const MEM_IOWRITE = 4;
const MEM_ICLR = 5; // Interrupt clear

let u8 = new Uint8Array(1);
let u16 = new Uint16Array(1);
let u32 = new Uint32Array(1);

const DEBUG = false;
let log = function(msg) {
    if(DEBUG) {
        console.log("[z80] "+msg);
    }
}

class Z80BankSetter extends Component {
    constructor(z80) {
        super();
        
        this._z80 = z80;
        this._bankBit = 0;
    }
    
    handleMemoryWrite(bus, addr, value, length, littleEndian) {
        let b = value & 0b1;
        if(this._bankBit == 9) {
            this._z80.shared[SHM_BANK] = b;
            this._z80.banker.setBank(this._z80.shared[SHM_BANK]);
            this._bankBit = 1;
        }else{
            this._z80.shared[SHM_BANK] |= b << this._bankBit;
            this._z80.banker.setBank(this._z80.shared[SHM_BANK]);
            this._bankBit ++;
        }
    }
    
    handleMemoryRead(bus, addr, length, littleEndian) {
        return 0xff;
    }
}

export class Z80 {
    constructor(emulator) {
        this.emu = emulator;
        
        this.worker = new Worker("./z80_worker.js", {"type":"module"});
        
        this.sharedBuff = new SharedArrayBuffer(5 * 4);
        this.shared = new Int32Array(this.sharedBuff);
        
        this.ramBuff = new SharedArrayBuffer(8 * 1024);
        this.ram = new DataView(this.ramBuff);
        this.banker = new BusBanker(emulator, this.emu.mdMem, 14, 0);
        
        this.worker.postMessage([MSG_INIT, [this.sharedBuff, this.emu.options, this.ramBuff]]);
        this.worker.onmessage = this.message.bind(this);
        
        this.reset = true;
        
        // MD Z80 Memory
        this.z80MdMem = new MemoryBus(this, [
            [new Ram(this.ram), 0x3fff, 0x1fff],
            [new NullComponent(), 0x5fff, 0x0000],
            [new Z80BankSetter(this), 0x6000, 0x0000],
            [this.banker, 0xffff, 0x7fff]
        ]);
    }
    
    start() {
        this.reset = true;
    }
    
    releaseBus() {
        log("Releasing bus");
        this.worker.postMessage([MSG_RELEASE, []]);
    }
    
    acquireBus() {
        log("Acquiring bus");
        this.worker.postMessage([MSG_ACQUIRE, []]);
    }
    
    startReset() {
        log("Starting reset");
        this.reset = true;
        this.worker.postMessage([MSG_STOP, []]);
    }
    
    stopReset() {
        log("Stopping reset");
        this.reset = false;
        this.worker.postMessage([MSG_RESET, []]);
        this.worker.postMessage([MSG_START, []]);
    }
    
    message(msg) {
        let dat = msg.data[1];
        
        switch(msg.data[0]) {
            case MSG_ACQUIRE_ACK:
                this.emu.busOwner = "z80";
                break;
            
            case MSG_RELEASE_ACK:
                this.emu.busOwner = "m68k";
                break;
            
            case MSG_DOIO:
                this.io();
                break;
            
            default:
                log("Got unknown message!");
        }
    }
    
    doFrame(factor) {
        this.worker.postMessage([MSG_FRAME, [factor]]);
    }
    
    handleInterrupt(bus, source, vector) {
        this.shared[SHM_INT] = vector;
    }
    
    readMemory(i) {
        i = i & 0xffff;
        
        return this.z80MdMem.readMemory(i, 2, false);
    }
    
    writeMemory(i, val) {
        i &= 0xffff;
        
        this.z80MdMem.writeMemory(i, 2, false);
    }
    
    readMemory8(i) {
        i = i & 0xffff;
        
        return this.z80MdMem.readMemory(i, 1, false);
    }
    
    writeMemory8(i, val) {
        i &= 0xffff;
        
        this.z80MdMem.writeMemory(i, val, 1, false);
    }
    
    _portIn(p) {
        if(p == 0x7e) {
            // V Counter
            return this.emu.vdp.readHvCount() >>> 8;
        }
        
        if(p == 0xbf) {
            // VDP status
            // TODO: Bit 6 should be H interrupt
            return this.emu.vdp.readControl() & 0xff;
        }
        
        if(p == 0x7f) {
            // H Counter
            return this.emu.vdp.readHvCount() & 0xff;
        }
        
        console.warn("Unknown port read " + p.toString(16));
        return 0;
    }
    
    _portOut(p, val) {
        if(p == 0xbe) {
            // VDP data
            this.emu.vdp.msWriteData(val);
            return;
        }
        
        if(p == 0xbf) {
            // VDP control
            this.emu.vdp.msWriteControl(val);
            return;
        }
        
        if(p == 0x7e || p == 0x7f) {
            // Sound Chip
            // TODO: this
            return;
        }
        
        console.warn("Unknown port write " + p.toString(16) + " : " + val.toString(16));
    }
    
    io() {
        let io = Atomics.load(this.shared, SHM_IO);
        if(io) {
            if(io == MEM_READ) {
                Atomics.store(this.shared, SHM_DATA, this.readMemory8(Atomics.load(this.shared, SHM_ADDR)));
            }else if(io == MEM_WRITE) {
                this.writeMemory8(Atomics.load(this.shared, SHM_ADDR), Atomics.load(this.shared, SHM_DATA));
            }else if(io == MEM_IOREAD) {
                Atomics.store(this.shared, SHM_DATA, this._portIn(Atomics.load(this.shared, SHM_ADDR)));
            }else if(io == MEM_IOWRITE) {
                this._portOut(Atomics.load(this.shared, SHM_ADDR), Atomics.load(this.shared, SHM_DATA));
            }else if(io == MEM_ICLR) {
                this.shared[SHM_INT] = 0;
            }
            Atomics.store(this.shared, SHM_IO, 0);
            Atomics.wake(this.shared, SHM_IO);
        }
    }
    
    loadRom(newRom, mode) {
        this.worker.postMessage([MSG_NEWROM, [newRom.buffer, mode]]);
    }
}
