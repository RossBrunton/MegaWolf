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

const DEBUG = false;
let log = function(msg) {
    if(DEBUG) {
        console.log(msg);
    }
}

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
    if(result < a) {
        ccr |= C | X;
    }
    if(a & b & (1 << ((length * 8) - 1)) || ~a & ~b & (1 << ((length * 8) - 1))) {
        if(!(a & result & (1 << ((length * 8) - 1)))) {
            ccr |= V;
        }
    }
    return ccr;
}

let lengthMask = function(length) {
    switch(length) {
        case 1:
            return 0xff;
        case 2:
            return 0xffff;
        case 3:
            return 0xffffffff;
    }
}

export class M68k {
    constructor(emulator) {
        this.registers = new Uint32Array(18);
        
        this.emu = emulator;
        this.time = 0;
    }
    
    // Read N bytes the PC and increment it by length. If length = 2, the lower byte of the word is read
    pcAndAdvance(length) {
        if(length == 4) {
            this.time += 8;
        }else{
            this.time += 4;
        }
        
        if(length == 1) {
            let next = this.emu.readMemory(this.registers[PC]) & 0x00ff;
            this.registers[PC] += 2;
            return next;
        }else{
            let next = this.emu.readMemoryN(this.registers[PC], length);
            this.registers[PC] += length;
            return next;
        }
    }
    
    // Calculates the effective address that a given specifier points to and returns it
    addressEa(ea, length) {
        switch(ea & 0b111000) {
            case 0b010000: { // Address Register Indirect
                this.time += 4;
                return this.registers[ABASE + (ea & 0b000111)];
            }
            
            case 0b011000: { // Address Register Indirect with Postincrement Mode
                // TODO: This should be incremented/decremented by 2 if it's the SP
                this.time += 4;
                let toReturn = this.registers[ABASE + (ea & 0b000111)];
                this.registers[ABASE + (ea & 0b000111)] += length;
                return toReturn;
            }
            
            case 0b100000: { // Address Register Indirect with Predecrement Mode
                this.time += 6;
                this.registers[ABASE + (ea & 0b000111)] -= length;
                return this.registers[ABASE + (ea & 0b000111)];
            }
            
            case 0b101000: { // Address Register Indirect with Displacement Mode
                this.time += 8;
                let next = this.emu.readMemory(this.registers[PC]);
                this.registers[PC] += 2;
                next = makeSigned(next, 2);
                next += this.registers[ABASE + (ea & 0b000111)];
                return next;
            }
            
            case 0b111000: {
                let next = 0;
                
                if(ea == 0b111001 || ea == 0b111000) { // Absolute long/short
                    this.time += 8;
                    next = this.emu.readMemory(this.registers[PC]);
                    this.registers[PC] += 2;
                    if(ea == 0b111001) {
                        this.time += 4;
                        next <<= 16;
                        next |= this.emu.readMemory(this.registers[PC]);
                        this.registers[PC] += 2;
                    }
                }else if(ea == 0b111010) { // PC indirect with displacement mode
                    this.time += 8;
                    next = this.emu.readMemory(this.registers[PC]);
                    this.registers[PC] += 2;
                    next = makeSigned(next, 2);
                    next += this.registers[PC] - 2;
                }else{
                    console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
                }
                
                return next;
            }
            
            default:
                console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
                return 0x0;
        }
    }
    
    // Reads the value of an effective address, reads the value of `addressEa`, and also supports register reads
    readEa(ea, length) {
        switch(ea & 0b111000) {
            case 0b000000: { // Data Register Direct Mode
                return this.registers[DBASE + ea];
            }
            
            case 0b001000: { // Address Register Direct Mode
                return this.registers[ABASE + (ea & 0b000111)];
            }
            
            case 0b111000: {
                if(ea == 0b111100) { // Immediate
                    return this.pcAndAdvance(length);
                }else{ // Try if it's an address specifier
                    if(length == 4) this.time += 4;
                    return this.emu.readMemoryN(this.addressEa(ea, length), length);
                }
            }
            
            default:
                // Try if it's an address specifier
                return this.emu.readMemoryN(this.addressEa(ea, length), length);
        }
    }
    
    writeEa(ea, value, length) {
        switch(ea & 0b111000) {
            case 0b000000: { // Data Register Direct Mode
                this.registers[DBASE + ea] = value;
                return;
            }
            
            case 0b001000: { // Address Register Direct Mode
                this.registers[ABASE + (ea & 0b000111)] = value;
                return;
            }
            
            default: { // Try if it's an address specifier
                if(length == 4) this.time += 4;
                this.emu.writeMemoryN(this.addressEa(ea, length), value, length);
                return;
            }
        }
    }
    
    getImmediate(instruction) {
        let immediate;
        switch(instruction & 0x00c0) {
            case 0x0000:
                immediate = this.pcAndAdvance(1);
                return [1, immediate, u8];
            case 0x0040:
                immediate = this.pcAndAdvance(2);
                return [2, immediate, u16];
            case 0x0080:
                immediate = this.pcAndAdvance(4);
                return [4, immediate, u32];
        }
    }
    
    start() {
        this.registers[SP] = this.emu.readMemory32(0x0000);
        this.registers[PC] = this.emu.readMemory32(0x0004);
    }
    
    doInstruction() {
        let oldPc = this.registers[PC]
        let instruction = this.emu.readMemory(oldPc);
        this.registers[PC] += 2;
        this.time += 4;
        
        let noEffectiveAddress = instruction & 0xffc0;
        let effectiveAddress = instruction & ~0xffc0;
        
        log("-- Running instruction 0x" + instruction.toString(16) + " from 0x" + oldPc.toString(16));
        
        switch(noEffectiveAddress) {
            case 0x4a00:
            case 0x4a40:
            case 0x4a80: { // tst
                log("> tst");
                
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
            case 0x4cc0: { // movem (mem to register)
                log("> movem (to registers)");
                let length = 2;
                if(noEffectiveAddress == 0x4cc0) {
                    length = 4;
                }
                
                let mask = this.emu.readMemory(this.registers[PC]);
                this.registers[PC] += 2;
                this.time += 8;
                for(let a = 1; a <= 15; a ++) {
                    if(mask & (1 << a)) {
                        this.registers[a] = this.readEa(effectiveAddress, length);
                    }
                }
                
                return true;
            }
        }
        
        if(instruction == 0x023c) {
            let instruction2 = pcAndAdvance(2);
            if((instruction2 & 0xff00) == 0x0000) { // andi to ccr
                log("> andi to ccr");
                this.time += 12;
                this.registers[CCR] &= (instruction2 | 0xff00);
                return true;
            }else{
                console.error("Unknown opcode: 0x" + instruction.toString(16) + instruction2.toString(16) + 
                    " at 0x" + oldPc.toString(16));
                return false;
            }
        }
        
        if(instruction == 0x027c) { // andi to SR
            log("> andi to SR");
            console.error("ANDI to SR not yet supported.");
            return false;
        }
        
        if((instruction & 0xf1f0) == 0xc100) { // abcd
            log("> abcd");
            console.error("ABCD opcode not yet supported.");
            return false;
        }
        
        if((instruction & 0xf000) == 0xd000) { // add/adda
            log("> add/adda");
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
                this.time += 4;
                register += ABASE;
                let ea = makeSigned(this.readEa(effectiveAddress, length));
                
                this.registers[register] += ea;
            }else{
                // < ea > + Dn -> Dn / < ea >
                let eaAddr = 0;
                let ea = 0;
                if(opmode & 0b100) {
                    eaAddr = this.addressEa(effectiveAddress, length);
                    ea = this.emu.readMemory(eaAddr);
                }else{
                    ea = this.readEa(effectiveAddress, length);
                }
                
                let reg = this.registers[register];
                tmp[0] = ea;
                tmp[0] += reg;
                
                this.registers[CCR] = addCcr(ea, reg, tmp[0]);
                
                if(opmode & 0b100) {
                    this.time += 4;
                    this.emu.writeMemoryN(eaAddr, tmp[0], length);
                }else{
                    this.registers[register] = tmp[0];
                }
            }
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0600 || (instruction & 0xf100) == 0x5000) { // addi
            log("> addi/addq");
            
            let length = 0;
            let immediate = 0;
            let tmp;
            let q = (instruction & 0xf100) == 0x5000;
            switch(instruction & 0x00c0) {
                case 0x0000:
                    length = 1;
                    if(!q) {
                        immediate = this.pcAndAdvance(1);
                    }
                    tmp = u8;
                    break;
                case 0x0040:
                    length = 2;
                    if(!q) {
                        immediate = this.pcAndAdvance(2);
                    }
                    tmp = u16;
                    break;
                case 0x0080:
                    length = 4;
                    if(!q) {
                        immediate = this.pcAndAdvance(4);
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
                
                if(length == 4) {
                    this.time += 4;
                }
                
                this.registers[effectiveAddress] = tmp[0];
            }else if((effectiveAddress & 0b111000) == 0b001000) {
                // To address register
                if(!q) {
                    log("Tried to add to an address register!");
                    return false;
                }
                this.time += 4;
                this.registers[effectiveAddress] += immediate;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress);
                let ea = this.emu.readMemoryN(addr, length);
                tmp[0] = ea;
                tmp[0] += immediate;
                
                if(q) {
                    this.time -= 8;
                }
                
                this.registers[CCR] = addCcr(immediate, ea, tmp[0]);
                
                this.emu.writeMemoryN(addr, tmp[0], length);
            }
            
            return true;
        }
        
        if((instruction & 0xf130) == 0xd100) { // addx
            log("> addx");
            console.error("ADDX opcode not yet supported.");
            return false;
        }
        
        if((instruction & 0xf000) == 0xc000) { // and
            log("> and");
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
                ea = this.emu.readMemory(eaAddr);
                this.time += 4;
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
                this.time += 4;
                if(length == 4) this.time += 4;
                this.emu.writeMemoryN(eaAddr, tmp[0], length);
            }else{
                this.registers[register] = (this.registers[register] & ~lengthMask(length)) & tmp[0];
                if(length = 4) {
                    this.time += 2;
                }
            }
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0200) { // andi
            log("> andi");
            let [length, immediate, tmp] = this.getImmediate(instruction);
            
            if((effectiveAddress & 0b111000) == 0b000000) {
                // To data register
                let reg = this.registers[effectiveAddress];
                this.registers[effectiveAddress] &= immediate;
                
                let ccr = this.registers[CCR] & X;
                ccr |= (this.registers[effectiveAddress]) & (1 << ((length * 8) - 1)) ? N : 0;
                ccr |= (this.registers[effectiveAddress]) == 0 ? Z : 0;
                this.registers[CCR] = ccr;
                
                if(length == 4) this.time += 4;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress);
                let ea = this.emu.readMemoryN(addr, length);
                tmp[0] = ea;
                tmp[0] &= immediate;
                
                let ccr = this.registers[CCR] & X;
                ccr |= (tmp[0]) & (1 << ((length * 8) - 1)) ? N : 0;
                ccr |= (tmp[0]) == 0 ? Z : 0;
                this.registers[CCR] = ccr;
                
                this.time += 4;
                if(length == 4) this.time += 4;
                this.emu.writeMemoryN(addr, tmp[0], length);
            }
            
            return true;
        }
        
        if((instruction & 0xf000) == 0xe000) { // asl/asr
            let cr = (instruction >> 9) & 0b111;
            let left = (instruction & 0x0100) != 0;
            let size = (instruction >> 6) & 0b11;
            let register = (instruction & 0x0020) != 0;
            let regNo = instruction & 0b111;
            
            if(size == 0b11) {
                // Memory shift
                let addr = this.addressEa(effectiveAddress);
                this.time += 4;
                
                let val = this.emu.readMemory(addr);
                let xc;
                let v;
                if(left) {
                    xc = val >> 15;
                    v = !((val & 0xc000) == 0x0 || (val & 0xc000) == 0xc000);
                    val <<= 1;
                }else{
                    xc = val & 0x0001;
                    v = 0; // MSB never changes since it is propagated
                    val >>= 1;
                }
                
                this.emu.writeMemory(addr, val);
                
                let ccr = 0;
                ccr |= xc ? (C | X) : 0;
                ccr |= isNegative(val, length) ? N : 0;
                ccr |= val == 0 ? Z : 0;
                ccr |= v ? V : 0;
                this.registers[CCR] = ccr;
            }else{
                // Register shift
                if(register) {
                    cr = this.registers[cr] % 64;
                }else{
                    if(cr == 0) cr = 8;
                }
                
                let length = 1;
                if(size == 0b01) {
                    length = 2;
                }else if(size == 0b10) {
                    length = 4;
                }
                
                this.time += 2 + (2 * cr);
                if(length == 4) this.time += 2;
                
                let val = this.registers[regNo] & lengthMask(length);
                let xc;
                let v;
                
                if(cr) {
                    if(left) {
                        xc = (value & (0x1 << ((length * 8) - 1) >> (cr - 1))) != 0;
                        let vmask = lengthMask(length) & ~(lengthMask(length) >> cr);
                        v = !((value & vmask) == vmask || (value & vmask) == 0);
                        value <<= cr;
                    }else{
                        // Right
                        xc = (value & (0x1 << (cr - 1))) != 0;
                        v = 0; // MSB never changes since it is propagated
                        value >>= cr;
                    }
                    
                    this.registers[regNo] = (this.registers[regNo] & ~lengthMask(length)) & (value & lengthMask(length));
                    
                    let ccr = 0;
                    ccr |= xc ? (C | X) : 0;
                    ccr |= isNegative(value, length) ? N : 0;
                    ccr |= value == 0 ? Z : 0;
                    ccr |= v ? V : 0;
                    this.registers[CCR] = ccr;
                }else{
                    let ccr = this.registers[CCR];
                    ccr &= X;
                    ccr |= isNegative(value, length) ? N : 0;
                    ccr |= value == 0 ? Z : 0;
                    this.registers[CCR] = ccr;
                }
            }
            
            return true;
        }
        
        if((instruction & 0xf100) == 0x0100 || (instruction & 0xff00) == 0x0800) { // btst/bchg/bclr/bset
            log("> btst/bchg/bclr/bset");
            
            let chg = (instruction & 0x0040) != 0;
            let clr = (instruction & 0x0080) != 0;
            let set = (instruction & 0x00c0) != 0;
            
            let bitNo;
            if((instruction & 0xffc0) == 0x0800) {
                // Immediate
                bitNo = this.pcAndAdvance(1);
            }else{
                // Register
                bitNo = this.registers[(instruction >> 9) & 0b111];
            }
            
            let mask;
            let value;
            if((effectiveAddress & 0b111000) == 0b000000) {
                // Register
                mask = 1 << (bitNo % 32);
                value = this.registers[effectiveAddress];
                
                if(chg) {
                    this.registers[effectiveAddress] ^= mask;
                }else if(clr) {
                    this.time += 2;
                    this.registers[effectiveAddress] &= ~mask;
                }else if(set) {
                    this.registers[effectiveAddress] |= mask;
                }else{
                    this.time -= 2;
                }
            }else{
                // Address
                mask = 1 << (bitNo % 8);
                let addr = this.addressEa(effectiveAddress, 1)
                value = this.emu.readMemory8(addr, 1);
                this.time += 4;
                
                if(chg) {
                    this.emu.writeMemory8(addr, value ^ mask);
                }else if(clr) {
                    this.emu.writeMemory8(addr, value & ~mask);
                }else if(set) {
                    this.emu.writeMemory8(addr, value | mask);
                }else{
                    this.time -= 4;
                }
            }
            
            let ccr = this.registers[CCR];
            ccr &= ~Z;
            ccr |= (value & mask) ? 0 : Z;
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xf0f8) == 0x50c8) { // dbcc
            log("> dbcc");
            let reg = instruction & 0b111;
            let condition = (instruction >> 8) & 0b1111;
            let displacement = this.pcAndAdvance(2);
            
            this.time += 6;
            
            if(!doCondition(condition, this.registers[CCR])) {
                let newVal = (this.registers[reg] & 0x0000ffff) - 1;
                this.registers[reg] = (this.registers[reg] & 0xffff0000) | (newVal & 0x0000ffff);
                if(newVal != -1) {
                    log("Continuing loop");
                    this.registers[PC] = oldPc + makeSigned(displacement, 2) + 2;
                    this.time -= 4;
                }else{
                    this.time -= 2;
                }
            }
            return true;
        }
        
        if((instruction & 0xf1c0) == 0x41c0) { // lea
            log("> lea");
            // TODO: Use only supported modes
            let reg = (instruction & 0x0e00) >> 9;
            this.registers[ABASE + reg] = this.addressEa(effectiveAddress, 4);
            return true;
        }
        
        if((instruction & 0xf100) == 0x7000) { // moveq
            log("> moveq");
            
            let data = instruction & 0x00ff;
            let reg = (instruction >> 9) & 0b111;
            
            this.registers[reg] = makeSigned(data);
            
            let ccr = this.registers[CCR] & X;
            ccr |= isNegative(this.registers[reg], 4) ? N : 0;
            ccr |= (this.registers[reg]) == 0 ? Z : 0;
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xfff0) == 0x4e60) { // move usp
            log("> move usp");
            let reg = ABASE + (instruction & 0b111);
            
            if(instruction & 0x0080) {
                // Stack > address
                this.registers[reg] = this.registers[SP];
            }else{
                // Address > stack
                this.registers[SP] = this.registers[reg];
            }
            return true;
        }
        
        if((instruction & 0xf000) == 0x6000) { // bcc/bra/bsr
            log("> bcc/bra/bsr");
            let condition = (instruction & 0x0f00) >> 8;
            let displacement = instruction & 0x00ff;
            let bsr = condition == 0b001;
            
            if(displacement == 0x00) {
                displacement = this.pcAndAdvance(2);
                displacement = makeSigned(displacement, 2);
            }else{
                displacement = makeSigned(displacement, 1);
            }
            
            if(!condition || bsr || doCondition(condition, this.registers[CCR])) {
                log("Performing branch");
                
                if(bsr) {
                    this.registers[SP] -= 4;
                    this.emu.writeMemory32(this.registers[SP], this.registers[PC]);
                    this.time += 8;
                }else{
                    this.time += 2;
                }
                
                this.registers[PC] = oldPc + displacement + 2;
            }else{
                this.time += 4;
            }
            return true;
        }
        
        if((instruction & 0xc000) == 0x0000 && (instruction & 0x3000)) { // move/mavea
            log("> move/movea");
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
        
        console.error("Unknown opcode: 0x" + instruction.toString(16) + " at 0x" + oldPc.toString(16));
        return false;
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
