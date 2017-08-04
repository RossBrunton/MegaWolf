"use strict";

import {M68k} from "./m68k.js";
import {Z80} from "./z80.js";
import {Controller} from "./controller.js";
import {Vdp} from "./vdp.js"

export const NTSC = "ntsc";
export const PAL = "pal";

const NTSC_CLOCK = 7670453;
const PAL_CLOCK = 7600489;

const FPS = 60;

const DEBUG = false;
let log = function(msg) {
    if(DEBUG) {
        console.log("[emulator] "+msg);
    }
}

export class Emulator {    
    constructor(options) {
        this.options = options ? options : {};
        if(this.options.version === undefined) {
            this.options.version = 0xa0a0;
        }
        if(this.options.region === undefined) {
            this.options.region = "ntsc";
        }
        
        this.mainRam = new DataView(new ArrayBuffer(1024*64));
        this.rom = null;
        
        this.copyProtected = (this.options.version & 0x0f) == 0;
        this._loCopy = false;
        this._hiCopy = false;
        
        this.m68k = new M68k(this);
        this.z80 = new Z80(this);
        this.vdp = new Vdp(this);
        
        this.m68kOwnBus = false;
        
        this.ports = [new Controller(), new Controller(), new Controller()];
        
        this.time = 0;
    }
    
    loadRom(rom) {
        this.rom = new DataView(rom);
    }
    
    readMemory(addr) {
        log("Memory read at 0x"+addr.toString(16));
        addr &= 0x00ffffff;
        
        if(addr <= 0x3fffff) {
            // ROM
            if(addr > this.rom.byteLength) {
                console.error("Out of bounds ROM read");
                debugger;
                return;
            }
            return this.rom.getUint16(addr, false);
        }
        
        if(addr > 0xe00000) {
            // Main RAM
            return this.mainRam.getUint16(addr & 0x00ffff, false);
        }
        
        switch(addr & ~1) {
            case 0xa11100:
                // Z80 /BUSREQ
                return (!this.m68kOwnBus || this.z80.reset) ? 0x1 : 0x0;
            
            case 0xa10000:
                // Version register
                return this.options.version;
            
            case 0xa10002:
            case 0xa10004:
            case 0xa10006:
                // Controller n data
                return this.ports[((addr & ~1) - 0xa10002) / 2].readData(this.time);
            
            case 0xa10008:
            case 0xa1000a:
            case 0xa1000c:
                // Controller n control
                return this.ports[((addr & ~1) - 0xa10008) / 2].readControl(this.time);
            
            case 0xc00000:
            case 0xc00002:
                // VDP Data
                return this.vdp.readData();
            
            case 0xc00004:
            case 0xc00006:
                // VDP Control
                return this.vdp.readControl();
            
            case 0xc00008:
            case 0xc0000a:
            case 0xc0000c:
            case 0xc0000e:
                // VDP HV Count
                return this.vdp.readHvCount();
        }
        
        //console.warn("Read from unknown memory address 0x"+addr.toString(16));
        
        return 0;
    }
    
    writeMemory(addr, value) {
        log("Memory write at 0x"+addr.toString(16)+", value 0x"+value.toString(16));
        addr &= 0x00ffffff;
        
        if(addr > 0xe00000) {
            // Main RAM
            this.mainRam.setUint16(addr & 0x00ffff, value, false);
            return;
        }
        
        // Memory IO
        switch(addr & ~0x1) {
            case 0xa10002:
            case 0xa10004:
            case 0xa10006:
                // Controller n data
                this.ports[((addr & ~1) - 0xa10002) / 2].writeData(value, this.time);
                return;
            
            case 0xa10008:
            case 0xa1000a:
            case 0xa1000c:
                // Controller n control
                this.ports[((addr & ~1) - 0xa10008) / 2].writeControl(value, this.time);
                return;
            
            case 0xa11100:
                // Z80 /BUSREQ
                if(value & 0x0101) {
                    this.z80.releaseBus();
                }else{
                    this.z80.acquireBus();
                }
                return;
            
            case 0xa11200:
                // Z80 /RESET
                if(value & 0x0101) {
                    this.z80.stopReset();
                }else{
                    this.z80.startReset();
                }
                return;
            
            case 0xc00000:
            case 0xc00002:
                // VDP Data
                this.vdp.writeData(value);
                return;
            
            case 0xc00004:
            case 0xc00006:
                // VDP Control
                this.vdp.writeControl(value);
                return;
            
            case 0xc00008:
            case 0xc0000a:
            case 0xc0000c:
            case 0xc0000e:
                // VDP HV Count
                this.vdp.writeHvCount(value);
                return;
        }
        
        if(addr == 0xa14000 && (this.options.version & 0x0f)) {
            if(value == 0x5345) this._loCopy = true;
            this.copyProtected = this._loCopy && this._hiCopy;
            return;
        }else if(addr == 0xa14002 && (this.options.version & 0x0f)) {
            if(value == 0x4741) this._hiCopy = true;
            this.copyProtected = this._loCopy && this._hiCopy;
            return;
        }
        
        //console.warn("Write to unknown memory address 0x"+addr.toString(16));
    }
    
    readMemory8(addr) {
        addr &= 0x00ffffff;
        
        if(addr <= 0x3fffff) {
            // ROM
            return this.rom.getUint8(addr, false);
        }
        
        if(addr > 0xe00000) {
            // Main RAM
            return this.mainRam.getUint8(addr & 0x00ffff, false);
        }
        
        return this.readMemory(addr) >>> 8;
    }
    
    writeMemory8(addr, value) {
        addr &= 0x00ffffff;
        
        if(addr > 0xe00000) {
            // Main RAM
            this.mainRam.setUint8(addr & 0x00ffff, value, false);
            return;
        }
        
        return this.writeMemory(addr, value & 0xff);
    }
    
    readMemory32(addr) {
        return this.readMemory(addr) << 16 | this.readMemory(addr + 2);
    }
    
    writeMemory32(addr, value) {
        this.writeMemory(addr, value >>> 16);
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
    
    runTime(factor) {
        this.running = true;
        this.vdp.handleFrame();
        
        if(this.options.region == PAL) {
            this.time += ~~((PAL_CLOCK / FPS) * factor);
        }else{
            this.time += ~~((NTSC_CLOCK / FPS) * factor);
        }
        
        //console.log("Delta: " + (this.time - this.m68k.time));
        
        while(this.m68k.time < this.time) {
            let ret = this.m68k.doInstruction();
            
            if(!ret) {
                console.log("Emulator stopping...");
                this.running = false;
                return;
            }
        }
            this.m68k.updateSpans();
        
        requestAnimationFrame(this.runTime.bind(this, factor));
    }
}
