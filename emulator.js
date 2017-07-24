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
    
    readEa(ea) {
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
                let next = this.readMemory(this.registers[PC]);
                this.registers[PC] += 2;
                
                if(ea == 0b111001) {
                    // Long addressing mode
                    next <<= 16;
                    next |= this.readMemory(this.registers[PC]);
                    this.registers[PC] += 2;
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
        let instruction = this.readMemory(this.registers[PC]);
        this.registers[PC] += 2;
        
        let noEffectiveAddress = instruction & 0xffc0;
        let effectiveAddress = instruction & ~0xffc0;
        
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
                
                let val = this.readEa(effectiveAddress);
                
                let ccr = this.registers[CCR] & X;
                ccr &= val == 0 ? Z : 0;
                ccr &= val < 0 ? N : 0;
                this.registers[CCR] = ccr;
                return;
        }
        
        console.log("Unknown opcode: 0x" + instruction.toString(16) + " at 0x" + this.registers[PC]);
    }
}
