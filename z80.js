"use strict";

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
        this.reset = true;
    }
    
    start() {
        this.reset = true;
    }
    
    releaseBus() {
        log("Releasing bus");
        this.emu.m68kOwnBus = true;
    }
    
    acquireBus() {
        log("Acquiring bus");
        this.emu.m68kOwnBus = false;
    }
    
    startReset() {
        log("Starting reset");
        this.reset = true;
    }
    
    stopReset() {
        log("Stopping reset");
        this.reset = false;
    }
    
    doInstruction() {
        
    }
}
