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
    
    readMemory8(addr) {
        return this.readMemory(addr) & 0x00ff;
    }
    
    readMemory32(addr) {
        return this.readMemory(addr) << 16 | this.readMemory(addr + 2);
    }
    
    readEa(ea, oldPc) {
        switch(ea & 0b111000) {
            case 0b000000:
                // Data Register Direct Mode
                return this.registers[DBASE + ea];
                break;
            
            case 0b001000:
                // Address Register Direct Mode
                return this.registers[ABASE + ea & 0b000111];
                
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
                    if(next & 0x8000) {
                        next -= 0xffff - 1;
                    }
                    next += oldPc + 0x0002;
                }else{
                    console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
                }
                
                return this.readMemory(next);
            
            default:
                console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
        }
    }
    
    writeMemory(addr, value) {
        
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
            case 0x4a80:
                // tst
                let length = 1;
                if(noEffectiveAddress == 0x4a40) {
                    length = 2;
                }else if(noEffectiveAddress == 0x4a80) {
                    length = 4;
                }
                
                let val = this.readEa(effectiveAddress, oldPc);
                
                let ccr = this.registers[CCR] & X;
                ccr &= val == 0 ? Z : 0;
                ccr &= val < 0 ? N : 0;
                this.registers[CCR] = ccr;
                return;
        }
        
        if((instruction & 0xf1c0) == 0x41c0) {
            // lea
            // TODO: Use only supported modes
            let reg = (instruction & 0x0e00) >> 9;
            console.log("Loading reg "+reg+" with "+effectiveAddress);
            this.registers[ABASE + reg] = this.readEa(effectiveAddress, oldPc);
            return;
        }
        
        if((instruction & 0xf000) == 0x6000) {
            // bcc
            let condition = instruction & 0x0f00;
            let displacement = instruction & 0x00ff;
            
            if(doCondition(condition, this.registers[CCR])) {
                if(displacement == 0x00) {
                    displacement = this.readMemory(this.registers[PC]);
                    this.registers[PC] += 2;
                    if(displacement & 0x8000) {
                        displacement -= 0xffff - 1;
                    }
                }else{
                    if(displacement & 0x80) {
                        displacement -= 0xff - 1;
                    }
                }
                
                this.registers[PC] = oldPc + displacement;
            }
            return;
        }
        
        console.log("Unknown opcode: 0x" + instruction.toString(16) + " at 0x" + this.registers[PC].toString(16));
    }
}
