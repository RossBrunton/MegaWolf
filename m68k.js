"use strict";

import {Ram, BusBanker, NullComponent} from "./basicComponents.js";
import {Component, MemoryBus} from "./busses.js";

const MSG_START = 0;
const MSG_STOP = 1;
const MSG_INIT = 2;
const MSG_RESET = 3;
const MSG_FRAME = 4;
const MSG_NEWROM = 5;
const MSG_DOIO = 6;

const SHM_IO = 0;
const SHM_DATA = 1;
const SHM_ADDR = 2;
const SHM_LENGTH = 3; // Length of the memory read/write
const SHM_INT = 4; // Interrupt

// Memory bus: SHM_IO is set by the worker depending on the operation, which is then cleared by the main Z80 class
// These are always m68k addresses, and always 32 bit read/writes
const MEM_NONE = 0;
const MEM_READ = 1;
const MEM_WRITE = 2;

let u8 = new Uint8Array(1);
let u16 = new Uint16Array(1);
let u32 = new Uint32Array(1);

const DEBUG = false;
let log = function(msg) {
    if(DEBUG) {
        console.log("[z80] "+msg);
    }
}

export class M68k {
    constructor(emulator) {
        this.emu = emulator;
        
        this.worker = new Worker("./m68k_worker.js", {"type":"module"});
        
        this.sharedBuff = new SharedArrayBuffer(5 * 4);
        this.shared = new Int32Array(this.sharedBuff);
        
        this.worker.postMessage([MSG_INIT, [this.sharedBuff, this.emu.options, this.emu.mainRamBuffer]]);
        this.worker.onmessage = this.message.bind(this);
    }
    
    message(msg) {
        let dat = msg.data[1];
        
        switch(msg.data[0]) {
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
    
    start() {
        this.worker.postMessage([MSG_START, []]);
    }
    
    handleInterrupt(bus, source, vector) {
        this.shared[SHM_INT] = vector;
    }
    
    readMemory(i, length) {
        i = i & 0xffffff;
        
        return this.emu.readMemoryN(i, length);
    }
    
    writeMemory(i, value, length) {
        i &= 0xffffff;
        
        this.emu.writeMemoryN(i, value, length);
    }
    
    io() {
        let io = Atomics.load(this.shared, SHM_IO);
        if(io) {
            let l = Atomics.load(this.shared, SHM_LENGTH);
            let i = Atomics.load(this.shared, SHM_ADDR);
            
            if(io == MEM_READ) {
                Atomics.store(this.shared, SHM_DATA, this.readMemory(i, l));
            }else if(io == MEM_WRITE) {
                this.writeMemory(i, Atomics.load(this.shared, SHM_DATA), l);
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
