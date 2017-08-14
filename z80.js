"use strict";

const MSG_START = 0;
const MSG_STOP = 1;
const MSG_INIT = 2;
const MSG_RESET = 3;
const MSG_FRAME = 4;

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
        
        this.sharedBuff = new SharedArrayBuffer(0);
        this.shared = new Uint32Array(this.sharedBuff);
        
        this.ramBuff = new SharedArrayBuffer(8 * 1024);
        this.ram = new DataView(this.ramBuff);
        
        this.worker.postMessage([MSG_INIT, [this.sharedBuff, this.emu.options, this.ramBuff]]);
        this.worker.onmessage = this.message.bind(this);
        
        this.reset = true;
    }
    
    start() {
        this.reset = true;
    }
    
    releaseBus() {
        log("Releasing bus");
        this.emu.m68kOwnBus = true;
        this.worker.postMessage([MSG_STOP, []]);
    }
    
    acquireBus() {
        log("Acquiring bus");
        this.emu.m68kOwnBus = false;
        if(!this.reset) this.worker.postMessage([MSG_START, []]);
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
        if(!this.emu.m68kOwnBus) this.worker.postMessage([MSG_START, []]);
    }
    
    message(msg) {
        let dat = e.data[1];
        
        switch(e.data[0]) {
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
        i = i & 0xffff;
        
        if(i < 0x4000) {
            // Memory
            i &= 0x1fff;
            return this.ram.setUint16(i, val, false);
        }
    }
}
