"use strict";
export const SP = 15;
export const PC = 16;
export const CCR = 17;
export const DBASE = 0;
export const ABASE = 8;

export const C = 0x0001; // Carry
export const V = 0x0002; // Overflow
export const Z = 0x0004; // Zero
export const N = 0x0008; // Negative
export const X = 0x0010; // Extend

let u8 = new Uint8Array(1);
let u16 = new Uint16Array(1);
let u32 = new Uint32Array(1);

let doCondition = function(condition, value) {
    switch(condition) {
        case 0b0000:
            // T
            return true;
        case 0b0001:
            // F
            return false;
        case 0b0010:
            // HI (¬C && ¬Z)
            return (value & (C | Z)) == 0;
        case 0b0011:
            // LS (C || Z)
            return (value & (C | Z)) != 0;
        case 0b0100:
            // Carry Clear (¬C)
            return (value & C) == 0;
        case 0b0101:
            // Carry Set (C)
            return (value & C) != 0;
        case 0b0110:
            // NE (¬Z)
            return (value & Z) == 0;
        case 0b0111:
            // EQ (Z)
            return (value & Z) != 0;
        case 0b1000:
            // VC (¬V)
            return (value & V) == 0;
        case 0b1001:
            // VS (V)
            return (value & V) != 0;
        case 0b1010:
            // PL (¬N)
            return (value & N) == 0;
        case 0b1011:
            // MI (N)
            return (value & N) != 0;
        case 0b1100:
            // GE (N && V || ¬N && ¬V)
            return ((value & N) && (value & V)) || ((value & (N | V)) == 0);
        case 0b1101:
            // LT (N && ¬V || ¬N && V)
            return ((value & N) && (value & V) == 0) || ((value & N) == 0 && value & V);
        case 0b1110:
            // GT (N && V && ¬Z || ¬N && ¬V && ¬Z)
            return (((value & N) && (value & V)) || ((value & (N | V)) == 0)) && (value & Z) == 0;
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

let addCcr = function(a, b, result) {
    let ccr = 0;
    ccr |= result == 0 ? Z : 0;
    ccr |= isNegative(result, length) ? N : 0;
    if(result < reg) {
        ccr |= C | X;
    }
    if(ea & reg & (1 << ((length * 8) - 1)) || ~ea & ~reg & (1 << ((length * 8) - 1))) {
        if(!(ea & result & (1 << ((length * 8) - 1)))) {
            ccr |= V;
        }
    }
    return ccr;
}

export class Emulator {    
    constructor(options) {
        this.options = options ? options : {};
        if(this.options.version === undefined) {
            this.options.version = 0xa0a0;
        }
        
        
        this.mainRam = new DataView(new ArrayBuffer(1024*64));
        this.registers = new Uint32Array(18);
        this.rom = null;
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
        
        console.warn("Write to unknown memory address 0x"+addr.toString(16));
    }
    
    readMemory8(addr) {
        return this.readMemory(addr) & 0xff;
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
    
    getImmediate(instruction) {
        let immediate;
        switch(instruction & 0x00c0) {
            case 0x0000:
                immediate = this.readMemory8(this.registers[PC]);
                this.registers[PC] += 2;
                return [1, immediate, u8];
            case 0x0040:
                immediate = this.readMemory(this.registers[PC]);
                this.registers[PC] += 2;
                return [2, immediate, u16];
            case 0x0080:
                immediate = this.readMemory32(this.registers[PC]);
                this.registers[PC] += 4;
                return [4, immediate, u32];
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
                console.log("> tst");
                let length = 1;
                if(noEffectiveAddress == 0x4a40) {
                    length = 2;
                }else if(noEffectiveAddress == 0x4a80) {
                    length = 4;
                }
                
                let val = this.readEa(effectiveAddress, length);
                
                let ccr = this.registers[CCR] & X;
                ccr |= val == 0 ? Z : 0;
                ccr |= isNegative(val, length) ? N : 0;
                this.registers[CCR] = ccr;
                return true;
            }
            
            case 0x4c80:
            case 0x4cc0: {
                // movem (mem to register)
                console.log("> movem (to registers)");
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
        
        if((instruction & 0xf1f0) == 0xc100) {
            // abcd
            console.log("> abcd");
            console.error("ABCD opcode not yet supported.");
            return false;
        }
        
        if((instruction & 0xf000) == 0xd000) {
            // add/adda
            console.log("> add/adda");
            let register = (instruction >> 9) & 0b111;
            let opmode = (instruction >> 6) & 0b111;
            let length = 0;
            let tmp;
            let addr = false;
            
            // Get length
            switch(opmode) {
                case 0b000:
                case 0b100:
                    length = 1;
                    tmp = u8;
                    break;
                
                case 0b001:
                case 0b101:
                case 0b011:
                    length = 2;
                    tmp = u16;
                    break;
                
                case 0b010:
                case 0b110:
                case 0b111:
                    length = 4;
                    tmp = u32;
                    break;
            }
            
            // Do the math
            if((opmode & 0b011) == 0b011) {
                // < ea > + An -> An
                register += ABASE;
                let ea = makeSigned(this.readEa(effectiveAddress, length));
                
                this.registers[register] += ea;
            }else{
                // < ea > + Dn -> Dn / < ea >
                let eaAddr = 0;
                let ea = 0;
                if(opmode & 0b100) {
                    eaAddr = this.addressEa(effectiveAddress, length);
                    ea = this.readMemory(eaAddr);
                }else{
                    ea = this.readEa(effectiveAddress, length);
                }
                
                let reg = this.registers[register];
                tmp[0] = ea;
                tmp[0] += reg;
                
                this.registers[CCR] = addCcr(ea, reg, tmp[0]);
                
                if(opmode & 0b100) {
                    this.writeMemoryN(eaAddr, tmp[0], length);
                }else{
                    this.registers[register] = tmp[0];
                }
            }
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0600 || (instruction & 0xf100) == 0x5000) {
            // addi
            console.log("> addi/addq");
            let length = 0;
            let immediate = 0;
            let tmp;
            let q = (instruction & 0xf100) == 0x5000;
            switch(instruction & 0x00c0) {
                case 0x0000:
                    length = 1;
                    if(!q) {
                        immediate = this.readMemory8(this.registers[PC] + 1);
                        this.registers[PC] += 2;
                    }
                    tmp = u8;
                    break;
                case 0x0040:
                    length = 2;
                    if(!q) {
                        immediate = this.readMemory(this.registers[PC]);
                        this.registers[PC] += 2;
                    }
                    tmp = u16;
                    break;
                case 0x0080:
                    length = 4;
                    if(!q) {
                        immediate = this.readMemory32(this.registers[PC]);
                        this.registers[PC] += 4;
                    }
                    tmp = u32;
                    break;
            }
            
            if(q) {
                immediate = (instruction >> 9) & 0b111;
                if(immediate == 0) immediate = 8;
            }
            
            if((effectiveAddress & 0b111000) == 0b000000) {
                // To data register
                let reg = this.registers[effectiveAddress];
                tmp[0] = reg;
                tmp[0] += immediate;
                
                this.registers[CCR] = addCcr(immediate, reg, tmp[0]);
                
                this.registers[effectiveAddress] = tmp[0];
            }else if((effectiveAddress & 0b111000) == 0b001000) {
                // To address register
                if(!q) {
                    console.log("Tried to add to an address register!");
                    return false;
                }
                this.registers[effectiveAddress] += immediate;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress);
                let ea = this.readMemoryN(addr, length);
                tmp[0] = ea;
                tmp[0] += immediate;
                
                this.registers[CCR] = addCcr(immediate, ea, tmp[0]);
                
                this.writeMemoryN(addr, tmp[0], length);
            }
            
            return true;
        }
        
        if((instruction & 0xf130) == 0xd100) {
            // addx
            console.log("> addx");
            console.error("ADDX opcode not yet supported.");
            return false;
        }
        
        if((instruction & 0xf000) == 0xc000) {
            // and
            console.log("> and");
            let register = (instruction >> 9) & 0b111;
            let opmode = (instruction >> 6) & 0b111;
            let length = 0;
            let tmp;
            
            // Get length
            switch(opmode) {
                case 0b000:
                case 0b100:
                    length = 1;
                    tmp = u8;
                    break;
                
                case 0b001:
                case 0b101:
                    length = 2;
                    tmp = u16;
                    break;
                
                case 0b010:
                case 0b110:
                    length = 4;
                    tmp = u32;
                    break;
            }
            
            // Do the math
            let eaAddr = 0;
            let ea = 0;
            if(opmode & 0b100) {
                eaAddr = this.addressEa(effectiveAddress, length);
                ea = this.readMemory(eaAddr);
            }else{
                ea = this.readEa(effectiveAddress, length);
            }
            
            let reg = this.registers[register];
            tmp[0] = ea;
            tmp[0] &= reg;
            
            let ccr = this.registers[CCR] & X;
            ccr |= (tmp[0] & (1 << ((length * 8) - 1))) ? N : 0;
            ccr |= tmp[0] == 0 ? Z : 0;
            this.registers[CCR] = ccr;
            
            if(opmode & 0b100) {
                this.writeMemoryN(eaAddr, tmp[0], length);
            }else{
                this.registers[register] = tmp[0];
            }
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0200) {
            // andi
            console.log("> andi");
            let [length, immediate, tmp] = this.getImmediate(instruction);
            
            if((effectiveAddress & 0b111000) == 0b000000) {
                // To data register
                let reg = this.registers[effectiveAddress];
                this.registers[effectiveAddress] &= immediate;
                
                let ccr = this.registers[CCR] & X;
                ccr |= (this.registers[effectiveAddress]) & (1 << ((length * 8) - 1)) ? N : 0;
                ccr |= (this.registers[effectiveAddress]) == 0 ? Z : 0;
                this.registers[CCR] = ccr;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress);
                let ea = this.readMemoryN(addr, length);
                tmp[0] = ea;
                tmp[0] &= immediate;
                
                let ccr = this.registers[CCR] & X;
                ccr |= (tmp[0]) & (1 << ((length * 8) - 1)) ? N : 0;
                ccr |= (tmp[0]) == 0 ? Z : 0;
                
                this.writeMemoryN(addr, tmp[0], length);
            }
            
            return true;
        }
        
        if((instruction & 0xf1c0) == 0x41c0) {
            // lea
            console.log("> lea");
            // TODO: Use only supported modes
            let reg = (instruction & 0x0e00) >> 9;
            this.registers[ABASE + reg] = this.addressEa(effectiveAddress, 4);
            return true;
        }
        
        if((instruction & 0xf000) == 0x6000) {
            // bcc
            console.log("> bcc");
            let condition = (instruction & 0x0f00) >> 8;
            let displacement = instruction & 0x00ff;
            
            if(doCondition(condition, this.registers[CCR])) {
                if(displacement == 0x00) {
                    displacement = this.readMemory(this.registers[PC]);
                    this.registers[PC] += 2;
                    displacement = makeSigned(displacement, 2);
                }else{
                    displacement = makeSigned(displacement, 1);
                }
                
                this.registers[PC] = oldPc + displacement + 2;
            }
            return true;
        }
        
        if((instruction & 0xc000) == 0x0000) {
            // move/mavea
            console.log("> move/movea");
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
            this.writeEa(destEa, val, length);
            return true;
        }
        
        console.log("Unknown opcode: 0x" + instruction.toString(16) + " at 0x" + this.registers[PC].toString(16));
        return false;
    }
}
