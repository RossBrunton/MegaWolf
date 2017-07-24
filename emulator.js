"use strict";
const SP = 15;
const PC = 16;
const CCR = 17;
const DBASE = 0;
const ABASE = 8;

const C = 0x0001; // Carry
const V = 0x0002; // Overflow
const Z = 0x0004; // Zero
const N = 0x0008; // Negative
const X = 0x0010; // Extend

let doCondition = function(condition, value) {
    switch(condition) {
        case 0b0000:
            // T
            return true;
        case 0x0001:
            // F
            return false;
        case 0x0010:
            // HI (¬C && ¬Z)
            return (value & (C | Z)) == 0;
        case 0x0011:
            // LS (C || Z)
            return (value & (C | Z)) != 0;
        case 0x0100:
            // Carry Clear (¬C)
            return (value & C) == 0;
        case 0x0101:
            // Carry Set (C)
            return (value & C) != 0;
        case 0x0110:
            // NE (¬Z)
            return (value & Z) != 0;
        case 0x0111:
            // EQ (Z)
            return (value & Z) == 0;
        case 0x1000:
            // VC (¬V)
            return (value & V) == 0;
        case 0x1001:
            // VS (V)
            return (value & V) != 0;
        case 0x1010:
            // PL (¬N)
            return (value & N) == 0;
        case 0x1011:
            // MI (N)
            return (value & N) != 0;
        case 0x1100:
            // GE (N && V || ¬N && ¬V)
            return (value & N && value & V) || ((value & (N | V)) == 0);
        case 0x1101:
            // LT (N && ¬V || ¬N && V)
            return (value & N && (value & V) == 0) || ((value & N) == 0 && value & V);
        case 0x1110:
            // GT (N && V && ¬Z || ¬N && ¬V && ¬Z)
            return ((value & N && value & V) || ((value & (N | V)) == 0)) && (value & Z) == 0;
    }
}

let isNegative = function(val, length) {
    if(length == 1) {
        return (val & 0x80) != 0;
    }else if(length == 2) {
        return (val & 0x8000) != 0;
    }else{
        return (val & 0x80000000) != 0;
    }
}

let makeSigned = function(val, length) {
    if(length == 1) {
        return (val & 0x80) ? val - 0xff - 1 : val;
    }else if(length == 2) {
        return (val & 0x8000) ? val - 0xffff - 1 : val;
    }else{
        return (val & 0x80000000) ? - 0xffffffff - 1 : val;
    }
}

export class Emulator {    
    constructor(options) {
        this.options = options;
        
        this.mainRam = new DataView(new ArrayBuffer(1024*64));
        this.registers = new Uint32Array(18);
        this.rom = null;
    }
    
    loadRom(rom) {
        this.rom = new DataView(rom);
    }
    
    readMemory(addr) {
        console.log("Memory read at 0x"+addr.toString(16));
        
        if(addr < 0x003fffff) {
            // ROM
            return this.rom.getUint16(addr, false);;
        }
        
        return 0;
    }
    
    writeMemory(addr, value) {
        console.log("Memory write at 0x"+addr.toString(16)+", value 0x"+value.toString(16));
    }
    
    readMemory8(addr) {
        return (this.readMemory(addr) & 0xff) >> 8;
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
    
    // Calculates the effective address that a given specifier points to and returns it
    addressEa(ea, length) {
        switch(ea & 0b111000) {
            case 0b011000: {
                // Address Register Indirect with Postincrement Mode
                let toReturn = this.registers[ABASE + (ea & 0b000111)];
                this.registers[ABASE + (ea & 0b000111)] += length;
                return toReturn;
            }
            
            case 0b101000: {
                // Address Register Indirect with Displacement Mode 
                let next = this.readMemory(this.registers[PC]);
                this.registers[PC] += 2;
                next = makeSigned(next, 2);
                next += this.registers[ABASE + (ea & 0b000111)];
                return next;
            }
            
            case 0b111000:
                // Absolute Short/Long addressing mode
                let next = 0;
                
                if(ea == 0b111001 || ea == 0b111000) {
                    // Long addressing mode
                    next = this.readMemory(this.registers[PC]);
                    this.registers[PC] += 2;
                    if(ea == 0b111001) {
                        next <<= 16;
                        next |= this.readMemory(this.registers[PC]);
                        this.registers[PC] += 2;
                    }
                }else if(ea == 0b111010) {
                    // PC indirect with displacement mode
                    next = this.readMemory(this.registers[PC]);
                    this.registers[PC] += 2;
                    next = makeSigned(next, 2);
                    next += this.registers[PC] - 2;
                }else{
                    console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
                }
                
                return next;
            
            default:
                console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
                return 0x0;
        }
    }
    
    // Reads the value of an effective address, reads the value of `addressEa`, and also supports register reads
    readEa(ea, length) {
        switch(ea & 0b111000) {
            case 0b000000:
                // Data Register Direct Mode
                return this.registers[DBASE + ea];
                break;
            
            case 0b001000:
                // Address Register Direct Mode
                return this.registers[ABASE + (ea & 0b000111)];
            
            default:
                // Try if it's an address specifier
                let addr = this.addressEa(ea, length);
                if(length == 1) {
                    return this.readMemory8(addr);
                }else if(length == 2) {
                    return this.readMemory(addr);
                }else{
                    return this.readMemory32(addr);
                }
        }
    }
    
    writeEa(ea, value, length) {
        switch(ea & 0b111000) {
            case 0b000000:
                // Data Register Direct Mode
                this.registers[DBASE + ea] = value;
                return;
            
            case 0b001000:
                // Address Register Direct Mode
                this.registers[ABASE + (ea & 0b000111)] = value;
                return;
            
            default:
                // Try if it's an address specifier
                let addr = this.addressEa(ea, length);
                if(length == 1) {
                    this.writeMemory8(addr, value);
                }else if(length == 2) {
                    this.writeMemory(addr, value);
                }else{
                    this.writeMemory32(addr, value);
                }
                return;
        }
    }
    
    start() {
        this.registers[SP] = this.readMemory32(0x0000);
        this.registers[PC] = this.readMemory32(0x0004);
    }
    
    doInstruction() {
        let oldPc = this.registers[PC]
        let instruction = this.readMemory(oldPc);
        this.registers[PC] += 2;
        
        let noEffectiveAddress = instruction & 0xffc0;
        let effectiveAddress = instruction & ~0xffc0;
        
        console.log("-- Running instruction 0x" + instruction.toString(16) + " from 0x" + oldPc.toString(16));
        
        switch(noEffectiveAddress) {
            case 0x4a00:
            case 0x4a40:
            case 0x4a80: {
                // tst
                let length = 1;
                if(noEffectiveAddress == 0x4a40) {
                    length = 2;
                }else if(noEffectiveAddress == 0x4a80) {
                    length = 4;
                }
                
                let val = this.readEa(effectiveAddress, length);
                
                let ccr = this.registers[CCR] & X;
                ccr &= val == 0 ? Z : 0;
                ccr &= isNegative(val, length) ? N : 0;
                this.registers[CCR] = ccr;
                return true;
            }
            
            case 0x4c80:
            case 0x4cc0: {
                // movem (mem to register)
                let length = 2;
                if(noEffectiveAddress == 0x4cc0) {
                    length = 4;
                }
                
                let mask = this.readMemory(this.registers[PC]);
                this.registers[PC] += 2;
                for(let a = 1; a <= 15; a ++) {
                    if(mask & (1 << a)) {
                        this.registers[a] = this.readEa(effectiveAddress, length);
                    }
                }
                
                return true;
            }
        }
        
        if((instruction & 0xf1c0) == 0x41c0) {
            // lea
            // TODO: Use only supported modes
            let reg = (instruction & 0x0e00) >> 9;
            this.registers[ABASE + reg] = this.addressEa(effectiveAddress, 4);
            return true;
        }
        
        if((instruction & 0xf000) == 0x6000) {
            // bcc
            let condition = instruction & 0x0f00;
            let displacement = instruction & 0x00ff;
            
            if(doCondition(condition, this.registers[CCR])) {
                if(displacement == 0x00) {
                    displacement = this.readMemory(this.registers[PC]);
                    this.registers[PC] += 2;
                    displacement = makeSigned(displacement, 2);
                }else{
                    displacement = makeSigned(displacement, 1);
                }
                
                this.registers[PC] = oldPc + displacement;
            }
            return true;
        }
        
        if((instruction & 0xc000) == 0x0000) {
            // move/mavea
            let length = 1;
            if((instruction & 0x3000) == 0x3000) {
                length = 2;
            }else if((instruction & 0x3000) == 0x2000) {
                length = 4;
            }
            
            let val = this.readEa(effectiveAddress, length);
            
            let ccr = this.registers[CCR] & X;
            ccr &= val == 0 ? Z : 0;
            ccr &= isNegative(val, length) ? N : 0;
            this.registers[CCR] = ccr;
            
            let destEa = (instruction & 0x0fc0) >> 6;
            destEa = (destEa >> 3) | ((destEa & 0b111) << 3);
            this.writeEa(destEa, length);
            return true;
        }
        
        console.log("Unknown opcode: 0x" + instruction.toString(16) + " at 0x" + this.registers[PC].toString(16));
        return false;
    }
}
