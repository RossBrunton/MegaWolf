"use strict";

import {M68k} from "./m68k.js";

export class Emulator {    
    constructor(options) {
        this.options = options ? options : {};
        if(this.options.version === undefined) {
            this.options.version = 0xa0a0;
        }
        
        this.mainRam = new DataView(new ArrayBuffer(1024*64));
        this.rom = null;
        
        this.copyProtected = (this.options.version & 0x0f) == 0;
        this._loCopy = false;
        this._hiCopy = false;
        
        this.m68k = new M68k(this);
    }
    
    loadRom(rom) {
        this.rom = new DataView(rom);
    }
    
    readMemory(addr) {
        console.log("Memory read at 0x"+addr.toString(16));
        
        if(addr < 0x3fffff) {
            // ROM
            return this.rom.getUint16(addr, false);;
        }
        
        if(addr == 0xa10000 || addr == 0xa10001) {
            return this.options.version;
        }
        
        console.warn("Read from unknown memory address 0x"+addr.toString(16));
        
        return 0;
    }
    
    writeMemory(addr, value) {
        console.log("Memory write at 0x"+addr.toString(16)+", value 0x"+value.toString(16));
        
        if(addr == 0xa14000 && (this.options.version & 0x0f)) {
            if(value == 0x5345) this._loCopy = true;
            this.copyProtected = this._loCopy && this._hiCopy;
            return;
        }else if(addr == 0xa14002 && (this.options.version & 0x0f)) {
            if(value == 0x4741) this._hiCopy = true;
            this.copyProtected = this._loCopy && this._hiCopy;
            return;
        }
        
        console.warn("Write to unknown memory address 0x"+addr.toString(16));
    }
    
    readMemory8(addr) {
        return this.readMemory(addr) >> 8;
    }
    
    writeMemory8(addr, value) {
        return this.writeMemory(addr, value & 0xff);
    }
    
    readMemory32(addr) {
        return this.readMemory(addr) << 16 | this.readMemory(addr + 2);
    }
    
    writeMemory32(addr, value) {
        this.writeMemory(addr, value >> 16);
        this.writeMemory(addr + 2, value & 0xffff);
    }
    
    readMemoryN(addr, n) {
        if(n == 1) {
            return this.readMemory8(addr);
        }else if(n == 2) {
            return this.readMemory(addr);
        }else{
            return this.readMemory32(addr);
        }
    }
    
    writeMemoryN(addr, value, n) {
        if(n == 1) {
            this.writeMemory8(addr, value);
        }else if(n == 2) {
            this.writeMemory(addr, value);
        }else{
            this.writeMemory32(addr, value);
        }
    }
    
    start() {
        this.m68k.start();
    }
    
    doInstruction() {
        return this.m68k.doInstruction();
    }
    
    doUntilFail(count) {
        for(let i = count; i > 0; i --) {
            if(!this.doInstruction()) {
                return false;
            }
        }
        
        return true;
    }
}
