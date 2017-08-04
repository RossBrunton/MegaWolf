"use strict";

const MSG_INIT = 0;
const MSG_RAF = 1;

const RM1 = 0;
const RM2 = 1;
const RPLANEA_NT = 2;
const RWINDOW_NT = 3;
const RPLANEB_NT = 4;
const RSPRITE_NT = 5;
const RSP_GEN = 6;
const RBACKGROUND = 7;
const RUNUSEDA = 8;
const RUNUSEDB = 9;
const RHORINT_C = 10;
const RM3 = 11;
const RM4 = 12;
const RHORSCROLL = 13;
const RNT_GEN = 14;
const RAUTOINC = 15;
const RPLANE_SIZE = 16;
const RWPLANE_HORPOS = 17;
const RWPLANE_VERPOS = 18;
const RDMAL_LO = 19;
const RDMAL_HI = 20;
const RDMAS_LO = 21;
const RDMAS_MI = 22;
const RDMAS_HI = 23;
const RSTATUS = 24;
const RCODE = 25;

const VRAM_R = 0b0000;
const VRAM_W = 0b0001;
const CRAM_W = 0b0011;
const VSRAM_R = 0b0100;
const VSRAM_W = 0b0101;
const CRAM_R = 0b1000;

let colours = function(x) {
    x = ~x;
    let ret = 0;
    if(x & 0b0001) ret |= 0x0000ff00;
    if(x & 0b0010) ret |= 0x00ff0000;
    if(x & 0b0100) ret |= 0xff000000;
    if(x & 0b1000) ret /= 2;
    
    ret |= 0x000000ff;
    return ret;
}

// TODO: 8 bit writes corectly

export class Vdp {
    constructor(emulator) {
        this.emu = emulator;
        
        this.worker = new Worker("./vdp_worker.js", {"type":"module"});
        
        this.registerBuffer = new SharedArrayBuffer(26);
        this.vramBuffer = new SharedArrayBuffer(64 * 1024);
        this.vram = new DataView(this.vramBuffer);
        this.cramBuffer = new SharedArrayBuffer(64 * 9);
        this.cram = new DataView(this.cramBuffer);
        this.vsramBuffer = new SharedArrayBuffer(40 * 10);
        this.vsram = new DataView(this.vsramBuffer);
        this.registers = new Uint8Array(this.registerBuffer);
        
        this.worker.postMessage([MSG_INIT, [this.registerBuffer, this.vramBuffer, this.cramBuffer, this.vsramBuffer]]);
        this.dblWord = false;
        this.awaitingFill = false;
        
        this.address = 0;
    }
    
    writeControl(value) {
        if(value & 0x8000) {
            // Internal register write
            let addr = (value >> 8) & 0x7f;
            let data = value & 0xff;
            this.registers[addr] = data;
        }else{
            if(this.dblWord) {
                let cd = (value >>> 2) & 0xff;
                this.registers[RCODE] &= ~0xfc;
                this.registers[RCODE] |= cd;
                
                this.address &= 0x3fff;
                this.address |= (value & 0b11) << 14;
                
                if(this.registers[RCODE] & 0b10000) {
                    //VRAM COPY DMA MODE
                    console.log("VRAM COPY DMA MODE");
                }
                
                if(this.registers[RCODE] & 0b100000) {
                    //DMA trigger
                    this.doDma();
                }
                
                this.dblWord = false;
            }else{
                this.dblWord = true;
                
                let cd = value >>> 14;
                this.registers[RCODE] &= ~0b11;
                this.registers[RCODE] |= cd;
                
                this.address &= 0xc000;
                this.address |= value & 0x3fff;
            }
        }
    }
    
    readControl() {
        this.dblWord = false;
        return this.registers[RSTATUS];
    }
    
    writeData(value) {
        this.dblWord = false;
        //console.log("Data write "+value);
        
        if(this.awaitingFill) {
            let lo = value & 0xff;
            let hi = value >>> 8;
            
            let length = (this.registers[RDMAL_HI] << 8) | this.registers[RDMAL_LO];
            let address = this.address;
            
            this.vram.setUint8(address, lo, false);
            
            do {
                this.vram.setUint8(address ^ 1, hi, false);
                address += this.registers[RAUTOINC];
            } while(-- length);
            
            this.awaitingFill = false;
            return;
        }
        
        let arr;
        switch(this.registers[RCODE] & 0b1111) {
            case VRAM_W: arr = this.vram; break;
            case CRAM_W: arr = this.cram; break;
            case VSRAM_W: arr = this.vsram; break;
            default: return;
        }
        
        arr.setUint16(this.address, value, false);
        this.address += this.registers[RAUTOINC];
    }
    
    readData() {
        this.dblWord = false;
        
        let arr;
        switch(this.registers[RCODE] & 0b1111) {
            case VRAM_R: arr = this.vram; break;
            case CRAM_R: arr = this.cram; break;
            case VSRAM_R: arr = this.vsram; break;
            default: return 0;
        }
        
        return arr.getUint16(this.address, false);
    }
    
    writeHvCount(value) {
        let length = (this.registers[RDMAL_HI] << 8) | this.registers[RDMAL_LO];
        
    }
    
    readHvCount() {
        
    }
    
    doDma() {
        console.log("Performing DMA!");
        if(!(this.registers[RM2] & 0x10)) {
            // But the flag is not set, so abort
            console.log("... Or not");
            return;
        }
        let length = (this.registers[RDMAL_HI] << 8) | this.registers[RDMAL_LO];
        let source =
            ((this.registers[RDMAS_HI] & 0x7f) << 16) | (this.registers[RDMAS_MI] << 8) | this.registers[RDMAS_LO];
        source <<= 1;
        
        let mode = this.registers[RDMAS_HI] >>> 6;
        if(mode == 0b10) {
            // VRAM fill (wait for data write)
            this.awaitingFill = true;
        }else if(mode == 0b11) {
            // VRAM copy
            console.error("VRAM Copy not yet implemented");
        }else{
            // 68k -> vdp ram
            console.log("True DMA in progress");
            let arr = this.vram;
            if((this.registers[RCODE] & 0b111) == CRAM_W) {
                arr = this.cram;
            }else if((this.registers[RCODE] & 0b111) == VSRAM_W) {
                arr = this.vsram;
            }
            
            let address = this.address;
            
            for(let i = 0; i < length; i ++) {
                let val = this.emu.readMemory(source);
                source += 2;
                arr.setUint16(address, val, false);
                address += this.registers[RAUTOINC];
            }
        }
    }
    
    dumpVram() {
        let out = new DataView(new ArrayBuffer(this.vramBuffer.byteLength * 8));
        let cols = 64;
        let p = 0;
        let low = false;
        
        let next = function() {
            let out;
            if(!low) {
                out = this.vram.getUint8(p, false) >>> 4;
            }else{
                out = this.vram.getUint8(p, false)& 0xf;
                p ++;
            }
            low = !low;
            return out;
        }
        
        for(let y = 0; y < (this.vram.byteLength / 0x20) / cols; y ++) {
            for(let x = 0; x < cols; x ++) {
                for(let sy = 0; sy < 8; sy ++) {
                    for(let sx = 0; sx < 8; sx ++) {
                        out.setUint32(((((y * 8) + sy) * (8 * cols)) + ((x * 8) + sx)) * 4, colours(next.call(this)), false);
                    }
                }
            }
        }
        return new ImageData(new Uint8ClampedArray(out.buffer), cols * 8);
    }
    
    handleFrame() {
        this.worker.postMessage([MSG_RAF, null]);
    }
}
