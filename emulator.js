"use strict";

import {M68k} from "./m68k.js";
import {Z80} from "./z80.js";

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
        this.z80 = new Z80(this);
        
        this.m68kOwnBus = false;
    }
    
    loadRom(rom) {
        this.rom = new DataView(rom);
    }
    
    readMemory(addr) {
        console.log("Memory read at 0x"+addr.toString(16));
        addr &= 0x00ffffff;
        
        if(addr < 0x3fffff) {
            // ROM
            return this.rom.getUint16(addr, false);
        }
        
        if(addr > 0xe00000) {
            // Main RAM
            return this.mainRam.getUint16(addr & 0x00ffff, false);
        }
        
        if((addr & ~0x1) == 0xa11100) {
            // /BUSREQ
            return (!this.m68kOwnBus || this.z80.reset) ? 0x1 : 0x0;
        }else if((addr & ~0x1) == 0xa10000) {
            return this.options.version;
        }
        
        console.warn("Read from unknown memory address 0x"+addr.toString(16));
        
        return 0;
    }
    
    writeMemory(addr, value) {
        console.log("Memory write at 0x"+addr.toString(16)+", value 0x"+value.toString(16));
        addr &= 0x00ffffff;
        
        if(addr > 0xe00000) {
            // Main RAM
            this.mainRam.setUint16(addr & 0x00ffff, value, false);
            return;
        }
        
        if((addr & ~0x1) == 0xa11100) {
            // /BUSREQ
            if(value & 0x0101) {
                this.z80.releaseBus();
            }else{
                this.z80.acquireBus();
            }
            return;
        }else if((addr & ~0x1) == 0xa11200) {
            // /RESET
            if(value & 0x0101) {
                this.z80.stopReset();
            }else{
                this.z80.startReset();
            }
            return;
        }else if(addr == 0xa14000 && (this.options.version & 0x0f)) {
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
