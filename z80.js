"use strict";

let u8 = new Uint8Array(1);
let u16 = new Uint16Array(1);
let u32 = new Uint32Array(1);

export class Z80 {    
    constructor(emulator) {
        this.emu = emulator;
        this.reset = true;
    }
    
    start() {
        this.reset = true;
    }
    
    releaseBus() {
        console.log("[Z80] Releasing bus");
        this.emu.m68kOwnBus = true;
    }
    
    acquireBus() {
        console.log("[Z80] Acquiring bus");
        this.emu.m68kOwnBus = false;
    }
    
    startReset() {
        console.log("[Z80] Starting reset");
        this.reset = true;
    }
    
    stopReset() {
        console.log("[Z80] Stopping reset");
        this.reset = false;
    }
    
    doInstruction() {
        
    }
}
