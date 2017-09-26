"use strict";

import {M68k} from "./m68k.js";
import {Z80} from "./z80.js";
import {Controller, Gamepad3, ControllerMultiplexer} from "./controller.js";
import {Vdp} from "./vdp.js"
import {MemoryBus, IoBus, InterruptBus, TimeBus} from "./busses.js";
import {Ram, SwappableRom} from "./basicComponents.js";

export const NTSC = "ntsc";
export const PAL = "pal";

const NTSC_CLOCK = 7670453;
const PAL_CLOCK = 7600489;

const MODE_MD = "md"; // Mega drive
const MODE_MS = "ms"; // Master system

const FPS = 60;

const DEBUG = false;
let log = function(msg) {
    if(DEBUG) {
        console.log("[emulator] "+msg);
    }
}

export class MegaDrive {
    constructor(options) {
        this.options = options ? options : {};
        if(this.options.version === undefined) {
            this.options.version = 0xa0a0;
        }
        if(this.options.region === undefined) {
            this.options.region = "ntsc";
        }
        if(!["crash", "ignore", "trap"].includes(this.options.invalidOp)) {
            this.options.invalidOp = "trap";
        }
        
        this.mainRam = new Ram(1024*64);
        this.rom = new SwappableRom();
        
        this.copyProtected = (this.options.version & 0x0f) == 0;
        this._loCopy = false;
        this._hiCopy = false;
        
        this.mdMem = new MemoryBus(this);
        this.m68k = new M68k(this);
        this.z80 = new Z80(this);
        this.vdp = new Vdp(this);
        
        this.busOwner = "z80";
        
        this.ports = new ControllerMultiplexer(this, [new Gamepad3(65, 79, 69, 13)]);
        
        this.time = 0;
        this.displayCounter = 0.0;
        this.mode = MODE_MD;
        this.workerCheckInterval = 0;
        
        // Create the busses
        
        // MD Memory
        this.mdMem.setChildren([
            [this.rom, 0x3fffff, 0x3fffff],
            [this.z80.z80MdMem, 0xa0ffff, 0x00ffff],
            [this.ports, 0xa10fff, 0x000fff],
            [this.vdp, 0xc0000f, 0x00000f],
            [this.mainRam, 0xffffff, 0x00ffff]
        ]);
    }
    
    loadRom(rom) {
        let dv = new DataView(rom);
        let newRom;
        
        if(dv.getUint16(8) == 0xaabb) {
            console.log("This looks like a .smd file, let me decode it for you...");
            
            let newBuff = new DataView(new SharedArrayBuffer(dv.byteLength - 512));
            
            for(let i = 512; i < dv.byteLength;) {
                let e = i - 512;
                let o = i + 1 - 512;
                
                for(let j = 0; j < 16 * 1024; j ++) {
                    if(j < 8 * 1024) {
                        newBuff.setUint8(o, dv.getUint8(i));
                        o += 2;
                    }else{
                        newBuff.setUint8(e, dv.getUint8(i));
                        e += 2;
                    }
                    i ++;
                }
            }
            
            newRom = newBuff;
        }else{
            let newBuff = new DataView(new SharedArrayBuffer(dv.byteLength));
            
            let i;
            for(i = 0; i <= dv.byteLength - 4; i += 4) {
                newBuff.setUint32(i, dv.getUint32(i));
            }
            
            if(i == dv.byteLength + 2) {
                newBuff.setUint16(i - 2, dv.getUint16(i - 2));
            }
            
            newRom = newBuff;
        }
        
        // Check if it is a master system ROM
        this.mode = MODE_MD;
        outer: for(let start of [0x1ff0, 0x3ff0, 0x7ff0]) {
            let msg = [0x54, 0x4d, 0x52, 0x20, 0x53, 0x45, 0x47, 0x41];
            for(let i = 0; i < msg.length; i ++) {
                if(msg[i] != newRom.getUint8(start + i)) {
                    continue outer;
                }
            }
            
            console.log("SMS ROM detected, switching to SMS mode.");
            this.mode = MODE_MS;
            break outer;
        }
        
        this.rom.swapRom(newRom);
        this.z80.loadRom(newRom, this.mode);
    }
    
    readMemory(addr) {
        log("Memory read at 0x"+addr.toString(16));
        addr &= 0x00ffffff;
        
        switch(addr & ~1) {
            case 0xa11100:
                // Z80 /BUSREQ
                // Do we need to check the reset state?
                return (this.busOwner != "m68k"/* || this.z80.reset*/) ? 0x1 : 0x0;
        }
        
        return this.mdMem.readMemory(addr, 2, false);
        
        console.warn("Read from unknown memory address 0x"+addr.toString(16));
        return 0;
    }
    
    writeMemory(addr, value) {
        log("Memory write at 0x"+addr.toString(16)+", value 0x"+value.toString(16));
        addr &= 0x00ffffff;
        
        // Memory IO
        switch(addr & ~0x1) {
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
        
        this.mdMem.writeMemory(addr, value, 2, false);
        //console.warn("Write to unknown memory address 0x"+addr.toString(16));
    }
    
    readMemory8(addr) {
        addr &= 0x00ffffff;
        
        return this.mdMem.readMemory(addr, 1, false);
    }
    
    writeMemory8(addr, value) {
        addr &= 0x00ffffff;
        
        this.mdMem.writeMemory(addr, value, 1, false);
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
        }else if(n == 4) {
            return this.readMemory32(addr);
        }else{
            console.error("Unknown n value ("+n+") sent to readMemoryN!");
            return 0;
        }
    }
    
    writeMemoryN(addr, value, n) {
        if(n == 1) {
            this.writeMemory8(addr, value);
        }else if(n == 2) {
            this.writeMemory(addr, value);
        }else if(n == 4) {
            this.writeMemory32(addr, value);
        }else{
            console.error("Unknown n value ("+n+") sent to readMemoryN!");
            return 0;
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
        
        this.displayCounter += factor;
        while(this.displayCounter >= 1.0) {
            this.vdp.handleFrame();
            this.displayCounter -= 1.0;
        }
        this.z80.doFrame(factor);
        
        if(this.options.region == PAL) {
            this.time += ~~((PAL_CLOCK / FPS) * factor);
        }else{
            this.time += ~~((NTSC_CLOCK / FPS) * factor);
        }
        
        //console.log("Delta: " + (this.time - this.m68k.time));
        
        if(this.mode == MODE_MD) {
            while(this.m68k.time < this.time) {
                let ret = this.m68k.doInstruction();
                this.z80.checkWorker();
                
                if(!ret) {
                    console.log("Emulator stopping...");
                    this.running = false;
                    return;
                }
            }
        }else{
            clearInterval(this.workerCheckInterval);
            setInterval(this.z80.checkWorker.bind(this.z80), 0);
        }
        //this.m68k.updateSpans();
        
        requestAnimationFrame(this.runTime.bind(this, factor));
    }
    
    clock() {
        if(this.options.region == PAL) {
            return PAL_CLOCK;
        }else{
            return NTSC_CLOCK;
        }
    }
}
