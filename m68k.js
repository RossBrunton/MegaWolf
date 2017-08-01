"use strict";
export const SP = 15;
export const PC = 16;
export const CCR = 17;
export const DBASE = 0;
export const ABASE = 8;

export const USER = 0;
export const SUPER = 1;
export const STOP = 2;

export const EX_ILLEGAL = 0x04;
export const EX_DIV0 = 0x05;
export const EX_CHK = 0x06;
export const EX_PRIV_VIO = 0x08;

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

let getOperandLength = function(instruction, allowAddress) {
    let opmode = (instruction >> 6) & 0b111;
    
    if(!allowAddress && (opmode & 0b011) == 0b011) {
        console.error("Invalid operand length value in 0x" + instruction.toString(16));
    }
    
    switch(opmode) {
        case 0b000:
        case 0b100:
            return [1, u8];
        
        case 0b001:
        case 0b101:
        case 0b011:
            return [2, u16];
        
        case 0b010:
        case 0b110:
        case 0b111:
            return [4, u32];
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

let addCcr = function(a, b, result, length) {
    let ccr = 0;
    ccr |= result == 0 ? Z : 0;
    ccr |= isNegative(result, length) ? N : 0;
    
    // Carry
    if(result < a) {
        ccr |= C | X;
    }
    
    // Overflow
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
        this.mode = SUPER;
        this.oldSp = 0;
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
    
    // Calculates and returns the ccr for a subtract operation (a - b)
    // When using negx or subx, set withExtend to true
    subCcr(a, b, result, length, touchX, withExtend) {
        let originalX = this.registers[CCR] & X;
        
        let ccr = this.registers[CCR] & (touchX ? 0 : X);
        if(withExtend) {
            ccr |= result == 0 ? Z : (this.registers[CCR] & Z);
        }else{
            ccr |= result == 0 ? Z : 0;
        }
        ccr |= isNegative(result, length) ? N : 0;
        
        // Borrow
        if(result > a) {
            ccr |= C | (touchX ? X : 0);
        }
        
        if(result == 0 && withExtend && originalX) {
            // Extend bit would cause borrow
            ccr |= C | (touchX ? X : 0);
        }
        
        //Overflow
        let as = makeSigned(a, length);
        let bs = makeSigned(b, length);
        let rs = makeSigned(result, length);
        
        if((rs < as) != (bs > 0)) {
            ccr |= V;
        }
        
        if(rs == (1 << (length * 8 - 1)) && withExtend && originalX) {
            // If the extend bit would cause an overflow
            ccr |= V;
        }
        
        return ccr;
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
        this.changeMode(SUPER);
        this.registers[SP] = this.emu.readMemory32(0x0000);
        this.registers[PC] = this.emu.readMemory32(0x0004);
    }
    
    changeMode(mode) {
        let oldMode = this.mode;
        this.mode = mode;
        
        if((this.mode == USER && oldMode == SUPER) || (this.mode == SUPER && oldMode == USER)) {
            let tmp = this.oldSp;
            this.oldSp = this.registers[SP];
            this.registers[SP] = tmp;
        }
    }
    
    trap(vector) {
        console.warn("Got exception 0x" + vector.toString(16) + ", halp");
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
            case 0x44c0: { // move to ccr
                log("> move to ccr");
                
                let val = this.readEa(effectiveAddress, 1);
                this.registers[CCR] &= ~lengthMask(1);
                this.registers[CCR] |= val;
                
                return true;
            }
            
            case 0x40c0: { // move from sr
                log("> move from sr");
                
                console.error("MOVE from SR not yet implemented");
                return false;
            }
            
            case 0x46c0: { // move to sr
                log("> move to sr");
                
                console.error("MOVE to SR not yet implemented");
                return false;
            }
            
            case 0xf800: { // nbcd
                log("> nbcd");
                console.error("NBCD not supported yet");
                return false;
            }
            
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
                
                let mask = this.pcAndAdvance(2);
                this.time += 8;
                for(let a = 0; a <= 15; a ++) {
                    if(mask & (1 << a)) {
                        let val = this.readEa(effectiveAddress, length);
                        if(length == 2) {
                            this.registers[a] &= ~lengthMask(2);
                            this.registers[a] |= val;
                        }else{
                            this.registers[a] = val;
                        }
                    }
                }
                
                return true;
            }
            
            case 0x4880:
            case 0x48c0: { // movem (register to mem)
                log("> movem (to memory)");
                let length = 2;
                if(noEffectiveAddress == 0x48c0) {
                    length = 4;
                }
                
                let reg = effectiveAddress & 0b111;
                let init = this.registers[ABASE + reg];
                let mask = this.pcAndAdvance(2);
                this.time += 4;
                for(let a = 0; a <= 15; a ++) {
                    if(mask & (1 << a)) {
                        if(15 - a == (ABASE + reg)) {
                            this.writeEa(effectiveAddress, init, length);
                        }else{
                            this.writeEa(effectiveAddress, this.registers[15 - a], length);
                        }
                    }
                }
                
                return true;
            }
            
            case 0x4840: { // pea
                log("> pea");
                
                this.registers[SP] -= 4;
                this.emu.writeMemory32(this.registers[SP], this.addressEa(effectiveAddress, 4), 4);
                return true;
            }
            
            case 0x4ec0: { // jmp
                log("> jmp");
                
                this.registers[PC] = this.addressEa(effectiveAddress, 2);
                this.time += 4;
                return true;
            }
            
            case 0x4e80: { // jsr
                log("> jsr");
                let addr = this.addressEa(effectiveAddress, 2);
                
                this.registers[SP] -= 4;
                this.emu.writeMemory32(this.registers[SP], this.registers[PC]);
                
                this.registers[PC] = addr;
                this.time += 12;
                return true;
            }
        }
        
        if(instruction == 0x023c) {
            let instruction2 = pcAndAdvance(2);
            if((instruction2 & 0xff00) == 0x0000) { // andi to ccr
                log("> andi to ccr");
                this.time += 16;
                this.registers[CCR] &= (instruction2 | 0xff00);
                return true;
            }else{
                console.error("Unknown opcode: 0x" + instruction.toString(16) + ":" + instruction2.toString(16) +
                    " at 0x" + oldPc.toString(16));
                return false;
            }
        }
        
        if(instruction == 0x003c) {
            let instruction2 = pcAndAdvance(2);
            if((instruction2 & 0xff00) == 0x0000) { // ori to ccr
                log("> ori to ccr");
                this.time += 16;
                this.registers[CCR] |= (instruction2 & 0xff);
                return true;
            }else{
                console.error("Unknown opcode: 0x" + instruction.toString(16) + ":" + instruction2.toString(16) +
                    " at 0x" + oldPc.toString(16));
                return false;
            }
        }
        
        if(instruction == 0x0a3c) {
            let instruction2 = pcAndAdvance(2);
            if((instruction2 & 0xff00) == 0x0000) { // eori to ccr
                log("> andi to ccr");
                this.time += 16;
                this.registers[CCR] ^= (instruction2 & 0x00ff);
                return true;
            }else{
                console.error("Unknown opcode: 0x" + instruction.toString(16) + ":" + instruction2.toString(16) +
                    " at 0x" + oldPc.toString(16));
                return false;
            }
        }
        
        if(instruction == 0x027c || instruction == 0x0a7c || instruction == 0x007c) { // andi/eori/ori to SR
            log("> andi/eori/ori to SR");
            console.error("ANDI/EORI/ORI to SR not yet supported.");
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
            
            [length, tmp] = getOperandLength(instruction, true);
            
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
                    // Destination is address
                    eaAddr = this.addressEa(effectiveAddress, length);
                    ea = this.emu.readMemory(eaAddr);
                }else{
                    // Destination is register
                    ea = this.readEa(effectiveAddress, length);
                }
                
                let reg = this.registers[register];
                tmp[0] = ea;
                tmp[0] += reg;
                
                this.registers[CCR] = addCcr(ea, reg, tmp[0], length);
                
                if(opmode & 0b100) {
                    // Destination is address
                    this.time += 4;
                    this.emu.writeMemoryN(eaAddr, tmp[0], length);
                }else{
                    // Destination is register
                    this.registers[register] = tmp[0];
                }
            }
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0600 || (instruction & 0xf100) == 0x5000) { // addi/addq
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
                let reg = this.registers[effectiveAddress] & lengthMask(length);
                tmp[0] = reg;
                tmp[0] += immediate;
                
                this.registers[CCR] = addCcr(immediate, reg, tmp[0], length);
                
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
                
                this.registers[CCR] = addCcr(immediate, ea, tmp[0], length);
                
                this.emu.writeMemoryN(addr, tmp[0], length);
            }
            
            return true;
        }
        
        if((instruction & 0xf130) == 0xd100) { // addx
            log("> addx");
            console.error("ADDX opcode not yet supported.");
            return false;
        }
        
        if((instruction & 0xf000) == 0xc000 || (instruction & 0xf100) == 0xb100 
        || (instruction & 0xf000) == 0x8000) { // and/eor/or
            log("> and/eor/or");
            let register = (instruction >> 9) & 0b111;
            let opmode = (instruction >> 6) & 0b111;
            let length = 0;
            let tmp;
            
            [length, tmp] = getOperandLength(instruction, false);
            
            // Do the math
            let eaAddr = 0;
            let ea = 0;
            if(opmode & 0b100) {
                // -> < ea >
                if((effectiveAddress & 0b111000) == 0) {
                    // Register
                    ea = this.registers[effectiveAddress];
                }else{
                    // Memory
                    eaAddr = this.addressEa(effectiveAddress, length);
                    ea = this.emu.readMemory(eaAddr);
                    this.time += 4;
                }
            }else{
                // -> r
                ea = this.readEa(effectiveAddress, length);
            }
            
            let reg = this.registers[register];
            tmp[0] = ea;
            switch(instruction & 0xf000) {
                case 0xc000: tmp[0] &= reg; break; // and
                case 0xb000: tmp[0] ^= reg; break; // eor
                case 0x8000: tmp[0] |= reg; break; // or
            }
            
            let ccr = this.registers[CCR] & X;
            ccr |= (tmp[0] & (1 << ((length * 8) - 1))) ? N : 0;
            ccr |= tmp[0] == 0 ? Z : 0;
            this.registers[CCR] = ccr;
            
            if(opmode & 0b100) {
                // -> < ea >
                if(length == 4) {
                    this.time += 2;
                    if((instruction & 0xf000) == 0xb000) {
                        // eor
                        this.time += 2;
                    }
                }
                
                if((effectiveAddress & 0b111000) == 0) {
                    // Register
                    this.registers[effectiveAddress] = (this.registers[effectiveAddress] & ~lengthMask(length)) | tmp[0];
                }else{
                    // Address
                    this.time += 4;
                    if(length == 4) this.time += 4;
                    
                    this.emu.writeMemoryN(eaAddr, tmp[0], length);
                }
            }else{
                // -> r
                this.registers[register] = (this.registers[register] & ~lengthMask(length)) | tmp[0];
                if((instruction & 0xf000) == 0xb000) {
                    // eor
                    console.error("Tried to write the result of an eor to non EA destination.");
                    debugger;
                    return false;
                }
            }
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0200 || (instruction & 0xff00) == 0x0a00
        || (instruction & 0xff00) == 0x0000) { // andi/eori/ori
            log("> andi/eori");
            let [length, immediate, tmp] = this.getImmediate(instruction);
            
            if((effectiveAddress & 0b111000) == 0b000000) {
                // To data register
                let reg = this.registers[effectiveAddress] & lengthMask(length);
                this.registers[effectiveAddress] = (this.registers[effectiveAddress] & ~lengthMask(length))
                this.registers[effectiveAddress] |= immediate;
                
                switch(instruction & 0xff00) {
                    case 0x0200: this.registers[effectiveAddress] &= reg; break; // andi
                    case 0x0a00: this.registers[effectiveAddress] ^= reg; break; // eori
                    case 0x0000: this.registers[effectiveAddress] |= reg; break; // ori
                }
                
                let ccr = this.registers[CCR] & X;
                ccr |= (this.registers[effectiveAddress]) & (1 << ((length * 8) - 1)) ? N : 0;
                ccr |= (this.registers[effectiveAddress]) == 0 ? Z : 0;
                this.registers[CCR] = ccr;
                
                if(length == 4) this.time += 4;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress);
                let ea = this.emu.readMemoryN(addr, length);
                tmp[0] = immediate;
                switch(instruction & 0xff00) {
                    case 0x0200: tmp[0] &= reg; break; // andi
                    case 0x0a00: tmp[0] ^= reg; break; // eori
                    case 0x0000: tmp[0] |= reg; break; // ori
                }
                
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
        
        if((instruction & 0xf000) == 0xe000) { // asl/asr/lsl/lsr
            let cr = (instruction >> 9) & 0b111;
            let left = (instruction & 0x0100) != 0;
            let size = (instruction >> 6) & 0b11;
            let register = (instruction & 0x0020) != 0;
            let regNo = instruction & 0b111;
            let logical;
            
            if(size == 0b11) {
                // Memory shift
                let addr = this.addressEa(effectiveAddress);
                this.time += 4;
                
                logical = (instruction & 0x0200) != 0;
                
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
                    if(logical) {
                        val >>= 1;
                    }else{
                        val >>>= 1;
                    }
                }
                
                this.emu.writeMemory(addr, val);
                
                let ccr = 0;
                ccr |= xc ? (C | X) : 0;
                ccr |= isNegative(val, length) ? N : 0;
                ccr |= val == 0 ? Z : 0;
                ccr |= (v && !logical) ? V : 0;
                this.registers[CCR] = ccr;
            }else{
                // Register shift
                if(register) {
                    cr = this.registers[cr] % 64;
                }else{
                    if(cr == 0) cr = 8;
                }
                
                logical = (instruction & 0b1000) != 0;
                
                let length = 1;
                if(size == 0b01) {
                    length = 2;
                }else if(size == 0b10) {
                    length = 4;
                }
                
                this.time += 2 + (2 * cr);
                if(length == 4) this.time += 2;
                
                let value = this.registers[regNo] & lengthMask(length);
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
                        if(logical) {
                            value >>>= cr;
                        }else{
                            value >>= cr;
                        }
                    }
                    
                    this.registers[regNo] = (this.registers[regNo] & ~lengthMask(length)) & (value & lengthMask(length));
                    
                    let ccr = 0;
                    ccr |= xc ? (C | X) : 0;
                    ccr |= isNegative(value, length) ? N : 0;
                    ccr |= value == 0 ? Z : 0;
                    ccr |= (v && !logical) ? V : 0;
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
        
        if((instruction & 0xf1c0) == 0x4180) { // chk
            log("> chk");
            this.time += 6;
            let register = (instruction >> 9) & 0b111;
            let upper = makeSigned(this.readEa(effectiveAddress, 2));
            let comp = makeSigned(this.registers[register] & lengthMask(2));
            
            if(comp < 0 || comp > upper) {
                let ccr = this.registers[CCR] & X;
                ccr |= (comp < 0) ? N : 0;
                this.registers[CCR] = ccr;
                
                this.trap(EX_CHK);
            }
        }
        
        if((instruction & 0xff00) == 0x4200) { // clr
            log("> clr");
            let [length, tmp] = getOperandLength(instruction, false);
            
            if((effectiveAddress & 0b111000) == 0b000000) {
                // Register
                this.registers[effectiveAddress] = 0;
                if(length == 4) this.time += 2;
            }else{
                // Address
                let addr = this.addressEa(effectiveAddress, length);
                this.emu.readMemoryN(addr, length); // A read still occurs according to the manual
                this.emu.writeMemoryN(addr, 0, length);
                this.time += 4;
                if(length == 4) this.time += 4;
            }
            
            this.writeEa(effectiveAddress, 0, length);
            
            let ccr = this.registers[CCR] & X;
            ccr |= Z;
            this.registers[CCR] = ccr;
        }
        
        if((instruction & 0xf000) == 0xb000) { // cmp/cmpa
            log("> cmp/cmpa");
            let register = (instruction >> 9) & 0b111;
            let opmode = (instruction >> 6) & 0b111;
            let length = 0;
            let tmp;
            let addr = false;
            
            [length, tmp] = getOperandLength(instruction, true);
            
            // Do the math
            if((opmode & 0b011) == 0b011) {
                // An - < ea >
                this.time += 2;
                register += ABASE;
                let ea = this.readEa(effectiveAddress, length);
                
                let reg = this.registers[register];
                tmp[0] = reg;
                tmp[0] -= ea;
                
                this.registers[CCR] = this.subCcr(ea, reg, tmp[0], length);
            }else{
                // Dn - < ea >
                if(length == 4) {
                    this.time += 2;
                }
                let eaAddr = 0;
                let ea = this.readEa(effectiveAddress, length);
                
                let reg = this.registers[register];
                tmp[0] = reg;
                tmp[0] -= ea;
                
                this.registers[CCR] = this.subCcr(ea, reg, tmp[0], length);
            }
            
            return true;
        }
        
        if((instruction & 0xf138) == 0xb108) { // cmpm
            log("> cmpm");
            let src = instruction & 0b111;
            let dst = (instruction >> 9) & 0b111;
            let length = 0;
            let tmp;
            let sm;
            let dm;
            
            [length, tmp] = getOperandLength(instruction, true);
            
            sm = this.readEa(0b011000 & src, length);
            dm = this.readEa(0b011000 & src, length);
            
            tmp[0] = dm;
            tmp[0] -= sm;
            
            this.registers[CCR] = this.subCcr(dm, sm, tmp[0], length);
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0c00) { // cmpi
            log("> cmpi");
            let [length, immediate, tmp] = this.getImmediate(instruction);
            
            if(length == 4 && (effectiveAddress & 0b111000) == 0) {
                this.time += 2;
            }
            
            let ea = this.readEa(effectiveAddress, length);
            tmp[0] = ea;
            tmp[0] -= immediate;
            
            this.registers[CCR] = this.subCcr(ea, immediate, tmp[0], length);
        }
        
        if((instruction & 0xf1c0) == 0x81c0) { // divs
            log("> divs");
            this.time += 154;
            let source = makeSigned(this.readEa(effectiveAddress, 2), 2);
            let reg = (instruction >> 9) & 0b111;
            let dest = makeSigned(this.registers[reg], 4); // "divides a long word by a word"
            
            if(source == 0) {
                this.trap(EX_DIV0);
                return true;
            }
            
            let result = dest / source;
            let remainder = dest % source * (dest < 0 ? -1 : 1);
            
            let ccr = this.registers[CCR] & X;
            ccr |= result == 0 ? Z : 0;
            ccr |= result < 0 ? N : 0;
            if((result > 0x7fff) || (result < -0x7fff)) {
                // Overflow!
                ccr |= V;
            }else{
                this.registers[reg] = ((remainder & 0xffff) << 16) | (result & 0xffff);
            }
            
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xf1c0) == 0x80c0) { // divu
            log("> divu");
            this.time += 136;
            let source = this.readEa(effectiveAddress, 2);
            let reg = (instruction >> 9) & 0b111;
            let dest = this.registers[reg]; // "divides a long word by a word"
            
            if(source == 0) {
                this.trap(EX_DIV0);
                return true;
            }
            
            let result = dest / source;
            let remainder = dest % source;
            
            let ccr = this.registers[CCR] & X;
            ccr |= result == 0 ? Z : 0;
            ccr |= result < 0 ? N : 0;
            if(result > 0xffff) {
                // Overflow!
                ccr |= V;
            }else{
                this.registers[reg] = ((remainder & 0xffff) << 16) | (result & 0xffff);
            }
            
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xf130) == 0xc100) { // exg
            log("> exg");
            this.time += 2;
            let mode = (instruction >> 3) & 0b11111;
            let rx = (instruction >> 9) & 0b111;
            let ry = instruction & 0b111;
            
            if((mode & 0b1) == 0b1) {
                ry += ABASE;
            }
            
            if(mode == 0b01001) {
                rx += ABASE;
            }
            
            let tmp = this.registers[ry];
            this.registers[ry] = this.registers[rx];
            this.registers[rx] = tmp;
            
            return true;
        }
        
        if((instruction & 0xffb8) == 0x4c00) { // ext
            log("> ext");
            let reg = instruction & 0b111;
            let dat = 0;
            let negative = false;
            
            if(!(instruction & 0b1000000)) {
                // Byte > word
                dat = makeSigned(this.registers[reg] & lengthMask(1), 1);
                this.registers[reg] &= ~lengthMask(2);
                this.registers[reg] |= dat & lengthMask(2);
            }else{
                // Word > long
                dat = makeSigned(this.registers[reg] & lengthMask(2), 2);
                this.registers[reg] = dat & lengthMask(4);
            }
            
            let ccr = this.registers[CCR] & X;
            ccr |= dat == 0 ? Z : 0;
            ccr |= dat < 0 ? N : 0;
            this.registers[CCR] = ccr;
            return true;
        }
        
        if(instruction == 0x4afc) { // illegal
            log("> illegal");
            
            this.trap(EX_ILLEGAL);
            return true;
        }
        
        if((instruction & 0xf1c0) == 0x41c0) { // lea
            log("> lea");
            // TODO: Use only supported modes
            let reg = (instruction & 0x0e00) >> 9;
            this.registers[ABASE + reg] = this.addressEa(effectiveAddress, 4);
            return true;
        }
        
        if((instruction & 0xfff8) == 0x4e50) { // link
            log("> link");
            let reg = (instruction & 0b111) + ABASE;
            let displacement = makeSigned(this.pcAndAdvance(2), 2);
            
            this.registers[SP] -= 4;
            this.emu.writeMemory(this.registers[SP], this.registers[reg], 4);
            this.registers[reg] = this.registers[SP];
            this.registers[SP] += displacement;
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
        
        if((instruction & 0xf038) == 0x008) { // movep
            log("> movep");
            console.error("MOVEP not supported");
        }
        
        if((instruction & 0xf1c0) == 0xc1c0) { // muls
            log("> muls");
            let register = (instruction >> 9) & 0b111;
            this.time += 66;
            
            let a = makeSigned(this.readEa(effectiveAddress, 2));
            let b = makeSigned(this.registers[register] & 0xffff, 2);
            let result = a * b;
            
            this.registers[register] = result;
            
            let ccr = this.registers[CCR] & X;
            ccr |= result == 0 ? Z : 0;
            ccr |= result < 0 ? N : 0;
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xf1c0) == 0xc0c0) { // mulu
            log("> mulu");
            let register = (instruction >> 9) & 0b111;
            this.time += 66;
            
            let a = this.readEa(effectiveAddress);
            let b = this.registers[register] & 0xffff;
            let result = a * b;
            
            this.registers[register] = result;
            
            let ccr = this.registers[CCR] & X;
            ccr |= result == 0 ? Z : 0;
            ccr |= (result & 0x80000000) ? N : 0;
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xfff0) == 0x4e60) { // move usp
            log("> move usp");
            if(this.mode == USER) {
                this.trap(EX_PRIV_VIO);
            }else{
                let reg = ABASE + (instruction & 0b111);
                
                if(instruction & 0x0080) {
                    // Stack > address
                    this.registers[reg] = this.oldSp;
                }else{
                    // Address > stack
                    this.oldSp = this.registers[reg];
                }
            }
            return true;
        }
        
        if((instruction & 0xfb00) == 0x4000) { // neg/negx
            log("> neg/negx");
            let [length, tmp] = getOperandLength(instruction, false);
            let x = (instruction & 0x0200) == 0;
            let xdec = (x && (this.registers[CCR] & X)) ? 1 : 0;
            
            tmp[0] = init;
            if(effectiveAddress & 0b111000) {
                // Memory location
                let addr = this.addressEa(effectiveAddress, length);
                let val = this.emu.readMemoryN(addr, length);
                
                tmp[0] -= val;
                
                this.registers[CCR] = this.subCcr(init, val, tmp[0], length, true, x);
                
                tmp[0] -= xdec;
                
                this.emu.writeMemoryN(addr, tmp[0], length);
                this.time += 4;
                if(length == 4) this.time += 4;
            }else{
                // Register
                let val = this.registers[effectiveAddress] & lengthMask(length);
                
                tmp[0] -= val;
                
                this.registers[CCR] = this.subCcr(init, val, tmp[0], length, true, x);
                
                tmp[0] -= xdec;
                
                this.registers[effectiveAddress] &= ~lengthMask(length);
                this.registers[effectiveAddress] |= tmp[0];
                
                if(length == 4) this.time += 2;
            }
            
            return true;
        }
        
        if((instruction & 0xf000) == 0xd000) { // sub/suba
            log("> sub/suba");
            let register = (instruction >> 9) & 0b111;
            let opmode = (instruction >> 6) & 0b111;
            let length = 0;
            let tmp;
            let addr = false;
            
            [length, tmp] = getOperandLength(instruction, true);
            
            // Do the math
            if((opmode & 0b011) == 0b011) {
                // < ea > - An -> An
                this.time += 4;
                register += ABASE;
                let ea = makeSigned(this.readEa(effectiveAddress, length));
                
                this.registers[register] -= ea;
            }else{
                // < ea > + Dn -> Dn / < ea >
                let eaAddr = 0;
                let ea = 0;
                let reg = this.registers[register];
                
                if(opmode & 0b100) {
                    // < ea > - dn -> < ea >
                    eaAddr = this.addressEa(effectiveAddress, length);
                    ea = this.emu.readMemory(eaAddr);
                    tmp[0] = ea;
                    tmp[0] -= reg;
                    
                    this.registers[CCR] = this.subCcr(ea, reg, tmp[0], length, true);
                    
                    this.time += 4;
                    this.emu.writeMemoryN(eaAddr, tmp[0], length);
                }else{
                    // dn - < ea > -> dn
                    ea = this.readEa(effectiveAddress, length);
                    
                    tmp[0] = reg;
                    tmp[0] -= ea;
                    
                    this.registers[CCR] = this.subCcr(reg, ea, tmp[0], length, true);
                    
                    this.registers[register] &= ~lengthMask(length);
                    this.registers[register] |= tmp[0];
                }
            }
            
            return true;
        }
        
        if((instruction & 0xf130) == 0x9100) { // subx
            log("> subx");
            console.error("SUBX opcode not yet supported.");
            return false;
        }
        
        if((instruction & 0xff00) == 0x0400 || (instruction & 0xf100) == 0x5100) { // subi/subq
            log("> subi/subq");
            
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
                let reg = this.registers[effectiveAddress] & lengthMask(length);
                tmp[0] = reg;
                tmp[0] -= immediate;
                
                this.registers[CCR] = this.subCcr(reg, immediate, tmp[0], length, true);
                
                if(length == 4) {
                    this.time += 4;
                }
                
                this.registers[effectiveAddress] &= ~lengthMask(length);
                this.registers[effectiveAddress] |= tmp[0];
            }else if((effectiveAddress & 0b111000) == 0b001000) {
                // To address register
                if(!q) {
                    log("Tried to subtract from address register!");
                    return false;
                }
                this.time += 4;
                this.registers[effectiveAddress] -= immediate;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress);
                let ea = this.emu.readMemoryN(addr, length);
                tmp[0] = ea;
                tmp[0] += immediate;
                
                if(q) {
                    this.time -= 8;
                }
                
                this.registers[CCR] = this.subCcr(ea, immediate, tmp[0], length, true);
                
                this.emu.writeMemoryN(addr, tmp[0], length);
            }
            
            return true;
        }
        
        if(instruction == 0x4e71) { // nop
            log("> nop");
            return true;
        }
        
        if((instruction & 0xf600) == 0x4600) { // not
            log("> not");
            let [length, tmp] = getOperandLength(instruction, false);
            let val = 0;
            
            if(effectiveAddress & 0b111000) {
                // Memory location
                let addr = this.addressEa(effectiveAddress, length);
                val = this.emu.readMemoryN(addr, length);
                
                this.emu.writeMemoryN(addr, ~val, length);
                this.time += 4;
                if(length == 4) this.time += 4;
            }else{
                // Register
                let val = this.registers[effectiveAddress] & lengthMask(length);
                
                this.registers[effectiveAddress] &= ~lengthMask(length);
                this.registers[effectiveAddress] |= tmp[0];
                
                if(length == 4) this.time += 2;
            }
            
            let ccr = this.registers[CCR] & X;
            ccr |= val == 0 ? Z : 0;
            ccr |= isNegative(val, length) ? N : 0;
            this.registers[CCR] = ccr;
            
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
        
        if(instruction == 0x4e70) { // reset
            log("> reset");
            // Apparently this has no effect?
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
