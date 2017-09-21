"use strict";

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

export class Z80 {
    constructor(emulator) {
        this.emu = emulator;
        
        this.worker = new Worker("./z80_worker.js", {"type":"module"});
        
        this.sharedBuff = new SharedArrayBuffer(5 * 4);
        this.shared = new Int32Array(this.sharedBuff);
        
        this.ramBuff = new SharedArrayBuffer(8 * 1024);
        this.ram = new DataView(this.ramBuff);
        
        this.worker.postMessage([MSG_INIT, [this.sharedBuff, this.emu.options, this.ramBuff]]);
        this.worker.onmessage = this.message.bind(this);
        
        this.reset = true;
        this.bankBit = 14;
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
            
            default:
                log("Got unknown message!");
        }
    }
    
    doFrame(factor) {
        this.worker.postMessage([MSG_FRAME, [factor]]);
    }
    
    readMemory(i) {
        i = i & 0xffff;
        
        if(i < 0x4000) {
            // Memory
            i &= 0x1fff;
            return this.ram.getUint16(i, false);
        }
    }
    
    writeMemory(i, val) {
        i &= 0xffff;
        
        if(i < 0x4000) {
            // Memory
            i &= 0x1fff;
            if(i == 0x1fff) debugger;
            this.ram.setUint16(i, val, false);
        }
    }
    
    readMemory8(i) {
        i = i & 0xffff;
        
        if(i < 0x4000) {
            // Memory
            i &= 0x1fff;
            return this.ram.getUint8(i);
        }
        
        if(i == 0x6000) {
            // Bank register
            return 0xff;
        }
        
        if(i >= 0x8000) {
            // 68k bank
            this.emu.readMemory8((i & 0x7fff) | this.shared[SHM_BANK]);
        }
    }
    
    writeMemory8(i, val) {
        i &= 0xffff;
        
        if(i < 0x4000) {
            // Memory
            i &= 0x1fff;
            this.ram.setUint8(i, val);
        }
        
        if(i == 0x6000) {
            // Bank register
            this.bankWrite(val);
        }
        
        if(i >= 0x8000) {
            // 68k bank
            this.emu.writeMemory8((i & 0x7fff) | this.shared[SHM_BANK], val);
        }
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
    
    checkWorker() {
        if(this.emu.vdp.interrupt()) {
            // TODO: This likely doesn't work in mega drive mode
            this.shared[SHM_INT] = this.emu.vdp.interrupt();
        }
        
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
                if(this.emu.mode == "ms") this.emu.vdp.clearInterrupt();
            }
            Atomics.store(this.shared, SHM_IO, 0);
            Atomics.wake(this.shared, SHM_IO);
        }
    }
    
    loadRom(newRom, mode) {
        this.worker.postMessage([MSG_NEWROM, [newRom.buffer, mode]]);
    }
    
    bankWrite(val) {
        let b = val & 0b1;
        if(this.bankBit == 23) {
            this.shared[SHM_BANK] = b << 15;
            this.bankBit = 15;
        }else{
            this.bankBit ++;
            this.shared[SHM_BANK] |= b << this.bankBit;
        }
    }
}
