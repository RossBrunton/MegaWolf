"use strict";
export const SP = 15;
export const PC = 16;
export const CCR = 17;
export const SR = 18;
export const DBASE = 0;
export const ABASE = 8;

export const USER = 0;
export const SUPER = 1;
export const STOP = 2;

export const EX_ILLEGAL = 0x04;
export const EX_DIV0 = 0x05;
export const EX_CHK = 0x06;
export const EX_TRAPV = 0x07;
export const EX_PRIV_VIO = 0x08;

export const C = 0x0001; // Carry
export const V = 0x0002; // Overflow
export const Z = 0x0004; // Zero
export const N = 0x0008; // Negative
export const X = 0x0010; // Extend

export const I0 = 0x0100; // Interrupt priority mask 1
export const I1 = 0x0200; // Interrupt priority mask 2
export const I2 = 0x0400; // Interrupt priority mask 3
export const S = 0x2000; // Supervisor
export const T = 0x8000; // Trace //TODO: Implement this

let u8 = new Uint8Array(1);
let u16 = new Uint16Array(1);
let u32 = new Uint32Array(1);

const DEBUG = false;

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
            return ((value & N) && (value & V) == 0) || ((value & N) == 0 && (value & V));
        case 0b1110:
            // GT (N && V && ¬Z || ¬N && ¬V && ¬Z)
            return (((value & N) && (value & V)) || ((value & (N | V)) == 0)) && (value & Z) == 0;
        case 0b1111:
            // LE (Z || (N && ¬V || ¬N && V)
            return (value & Z) || ((value & N) && !(value & V)) || (!(value & N) && (value & V));
        default:
            console.error("Invalid condition!");
            return;
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

let lengthString = function(l) {
    switch(l) {
        case 1: return ".b";
        case 2: return ".w";
        case 4: return ".l";
        default: return ".?";
    }
}

let conditionStr = function(condition) {
    switch(condition) {
        case 0b0000: return "t";
        case 0b0001: return "f";
        case 0b0010: return "hi";
        case 0b0011: return "ls";
        case 0b0100: return "cc";
        case 0b0101: return "cs";
        case 0b0110: return "ne";
        case 0b0111: return "eq";
        case 0b1000: return "vc";
        case 0b1001: return "vs";
        case 0b1010: return "pl";
        case 0b1011: return "mi";
        case 0b1100: return "ge";
        case 0b1101: return "lt";
        case 0b1110: return "gt";
    }
}

let isNegative = function(val, length) {
    if(length == 1) {
        return (val & 0x80) != 0;
    }else if(length == 2) {
        return (val & 0x8000) != 0;
    }else if(length == 4) {
        return (val & 0x80000000) != 0;
    }else{
        console.error("Unknown length for isNegative!");
        return false;
    }
}

let makeSigned = function(val, length) {
    if(length == 1) {
        return (val & 0x80) ? val - 0xff - 1 : val;
    }else if(length == 2) {
        return (val & 0x8000) ? val - 0xffff - 1 : val;
    }else if(length == 4) {
        return (val & 0x80000000) ? - 0xffffffff - 1 : val;
    }else{
        console.error("Unknown length for makeSigned!");
        return val;
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
    let highBitMask = 1 << ((length * 8) - 1)
    if((a & b & highBitMask) || (~a & ~b & highBitMask)) {
        if((a & highBitMask) != (result & highBitMask)) {
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
        case 4:
            return 0xffffffff;
        default:
            console.error("Unkown length value "+length+" for lengthMask");
    }
}

export class M68k {
    constructor(emulator) {
        this.registers = new Uint32Array(19);
        
        this.registers[SR] = S;
        
        this.emu = emulator;
        this.time = 0;
        this.mode = SUPER;
        this.oldSp = 0;
        this.logEntries = new Array(500);
        this.logp = 0;
    }
    
    log(msg) {
        if(DEBUG) {
            console.log("[m68k] " + msg);
        }
        this.logp += 1;
        this.logp %= 500;
        this.logEntries[this.logp] = msg;
    }
    
    dumpLog() {
        for(let i = this.logp; (i != this.logp +1) && !(this.logp == 500 && i == 0); (i != 0) ? i -- : i = 500) {
            console.log(this.logEntries[i]);
        }
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
    
    getExtensionWord() {
        let word = this.pcAndAdvance(2);
        
        let reg = (word >> 12) & 0b1111;
        let long = (word & (1 << 11)) != 0;
        let scale = 1 << ((word >> 9) & 0b11);
        let displacement = makeSigned(word & 0xff, 1);
        
        if(word & 0x0100) {
            console.log("Complicated extension word, help!");
            return [0, false, 1, 0];
        }
        
        return [reg, long, scale, displacement];
    }
    
    // Calculates the effective address that a given specifier points to and returns it
    addressEa(ea, length) {
        if(length === undefined) console.error("AddressEa called without a length param!");
        
        switch(ea & 0b111000) {
            case 0b010000: { // Address Register Indirect
                this.time += 4;
                return this.registers[ABASE + (ea & 0b000111)];
            }
            
            case 0b011000: { // Address Register Indirect with Postincrement Mode
                if((ea & 0b000111) == SP - ABASE && length == 1) {
                    length = 2; // Need to keep the stack aligned
                }
                this.time += 4;
                let toReturn = this.registers[ABASE + (ea & 0b000111)];
                this.registers[ABASE + (ea & 0b000111)] += length;
                return toReturn;
            }
            
            case 0b100000: { // Address Register Indirect with Predecrement Mode
                if((ea & 0b000111) == SP - ABASE && length == 1) {
                    length = 2; // Need to keep the stack aligned
                }
                this.time += 6;
                this.registers[ABASE + (ea & 0b000111)] -= length;
                return this.registers[ABASE + (ea & 0b000111)];
            }
            
            case 0b101000: { // Address Register Indirect with Displacement Mode
                this.time += 8;
                let next = this.pcAndAdvance(2);
                next = makeSigned(next, 2);
                next += this.registers[ABASE + (ea & 0b000111)];
                return next;
            }
            
            case 0b110000: { // Address Register Indirect with Index (8-Bit Displacement) Mode
                let [reg, long, scale, displacement] = this.getExtensionWord();
                this.time += 2;
                
                let addr = this.registers[ABASE + (ea & 0b000111)];
                addr += displacement;
                if(long) {
                    addr += makeSigned(this.registers[reg], 4) * scale;
                }else{
                    addr += makeSigned(this.registers[reg] & 0xffff, 2) * scale;
                }
                return addr;
            }
            
            case 0b111000: {
                let next = 0;
                
                if(ea == 0b111000) { // Absolute short
                    this.time += 8;
                    next = this.pcAndAdvance(2);
                    if(isNegative(next, 2)) {
                        next |= 0xffff0000;
                        next >>>= 0;
                    }
                }else if(ea == 0b111001) { // Absolute long
                    this.time += 12;
                    next = this.pcAndAdvance(2) << 16;
                    next |= this.pcAndAdvance(2);
                }else if(ea == 0b111010) { // PC indirect with displacement mode
                    this.time += 8;
                    next = this.pcAndAdvance(2);
                    next = makeSigned(next, 2);
                    next += this.registers[PC] - 2;
                }else if(ea == 0b111011) { // Program Counter Indirect with Index (8-Bit Displacement) Mode
                    let addr = this.registers[PC];
                    let [reg, long, scale, displacement] = this.getExtensionWord();
                    this.time += 2;
                    
                    addr += displacement;
                    if(long) {
                        addr += makeSigned(this.registers[reg], 4) * scale;
                    }else{
                        addr += makeSigned(this.registers[reg] & 0xffff, 2) * scale;
                    }
                    return addr;
                }else{
                    console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
                    return 0x0;
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
        if(length === undefined) console.error("Length is undefined");
        switch(ea & 0b111000) {
            case 0b000000: { // Data Register Direct Mode
                return this.registers[DBASE + ea] & lengthMask(length);
            }
            
            case 0b001000: { // Address Register Direct Mode
                return this.registers[ABASE + (ea & 0b000111)] & lengthMask(length);
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
                if(length == 4) this.time += 4;
                return this.emu.readMemoryN(this.addressEa(ea, length), length);
        }
    }
    
    writeEa(ea, value, length) {
        if(length === undefined) console.error("Length is undefined");
        switch(ea & 0b111000) {
            case 0b000000: { // Data Register Direct Mode
                this.registers[ea] &= ~lengthMask(length);
                this.registers[ea] |= value & lengthMask(length);
                return;
            }
            
            case 0b001000: { // Address Register Direct Mode
                this.registers[ea] = value;
                return;
            }
            
            default: { // Try if it's an address specifier
                if(length == 4) this.time += 4;
                this.emu.writeMemoryN(this.addressEa(ea, length), value, length);
                return;
            }
        }
    }
    
    eaStr(ea, length, pc) {
        switch(ea & 0b111000) {
            case 0b000000: { // Data register
                return "d" + ea;
            }
            
            case 0b001000: { // Address register
                return "a" + (ea & 0b000111);
            }
            
            case 0b010000: { // Address Register Indirect
                return "(a"+(ea & 0b000111)+")";
            }
            
            case 0b011000: { // Address Register Indirect with Postincrement Mode
                return "(a"+(ea & 0b000111)+")+";
            }
            
            case 0b100000: { // Address Register Indirect with Predecrement Mode
                return "-(a"+(ea & 0b000111)+")";
            }
            
            case 0b101000: { // Address Register Indirect with Displacement Mode
                return "($"+this.emu.readMemory(pc + 2).toString(16)+", a"+(ea & 0b000111)+")";
            }
            
            case 0b110000: { // Address Register Indirect with Index (8-Bit Displacement) Mode
                return "(a"+(ea & 0b000111)+
                    " indirect with index ext 0x"+this.emu.readMemory(pc + 2).toString(16)+")";
            }
            
            case 0b111000: {
                let next = 0;
                
                if(ea == 0b111000) { // Absolute short
                    let next = this.emu.readMemory(pc + 2);
                    if(isNegative(next, 2)) {
                        next |= 0xffff0000;
                        next >>>= 0;
                    }
                    return "(#$"+next.toString(16)+").w";
                }else if(ea == 0b111001) { // Absolute long
                    return "(#$"+this.emu.readMemory32(pc + 2).toString(16)+").l";
                }else if(ea == 0b111010) { // PC indirect with displacement mode
                    return "($"+this.emu.readMemory(pc + 2).toString(16)+", pc)";
                }else if(ea == 0b111011) { // Program Counter Indirect with Index (8-Bit Displacement) Mode
                    return "(pc indirect with index ext 0x"+this.emu.readMemory(pc + 2).toString(16)+")";
                }else if(ea == 0b111100) { // Immediate Data
                    return "$#"+this.emu.readMemoryN(pc + 2, length).toString(16)
                }else{
                    console.error("Unknown Effective Address mode: 0b" + ea.toString(2));
                }
                
                return next;
            }
            
            default:
                return "??";
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
            default:
                console.error("GetImmediate failed to find an immediate value!");
                return [2, 0, u16];
        }
    }
    
    // Get the properties of a shift/rotate operation
    getShift(instruction) {
        let cr = (instruction >> 9) & 0b111;
        let left = (instruction & 0x0100) != 0;
        let size = (instruction >> 6) & 0b11;
        let register = (instruction & 0x0020) != 0;
        let regNo = instruction & 0b111;
        
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
        
        return [cr, left, length, regNo];
    }
    
    start() {
        this.changeMode(SUPER);
        this.registers[SP] = this.emu.readMemory32(0x0000);
        this.registers[PC] = this.emu.readMemory32(0x0004);
    }
    
    changeMode(mode) {
        let oldMode = this.mode;
        this.mode = mode;
        this.log("Mode change " + oldMode + " -> " + this.mode);
        
        if((this.mode == USER && oldMode == SUPER) || (this.mode == SUPER && oldMode == USER)) {
            let tmp = this.oldSp;
            this.oldSp = this.registers[SP];
            this.registers[SP] = tmp;
        }
    }
    
    trap(vector) {
        this.log("Got exception 0x" + vector.toString(16));
        let tmp = this.registers[SR] | this.registers[CCR];
        this.registers[SR] &= 0x0fff;
        this.registers[SR] |= S;
        this.changeMode(SUPER);
        
        let handler = this.emu.readMemory32(vector * 4);
        this.registers[SP] -= 4;
        this.emu.writeMemory32(this.registers[SP], this.registers[PC]);
        this.registers[SP] -= 2;
        this.emu.writeMemory(this.registers[SP], tmp);
        this.registers[PC] = handler;
    }
    
    doInstruction() {
        // Check for external exception
        let i = this.emu.vdp.interrupt();
        let mask = (this.registers[SR] >>> 8) & 0b111; // Is this right?
        if(i > mask) {
            this.emu.vdp.clearInterrupt();
            this.time += 44;
            this.trap(0x18 + i);
        }
        
        let oldPc = this.registers[PC];
        let instruction = this.emu.readMemory(oldPc);
        this.registers[PC] += 2;
        this.time += 4;
        
        let noEffectiveAddress = instruction & 0xffc0;
        let effectiveAddress = instruction & ~0xffc0;
        
        this.log("-- Running instruction 0x" + instruction.toString(16) + " from 0x" + oldPc.toString(16));
        
        switch(noEffectiveAddress) {
            case 0x44c0: { // move to ccr
                this.log("> move to ccr");
                
                let val = this.readEa(effectiveAddress, 1);
                this.registers[CCR] &= ~lengthMask(1);
                this.registers[CCR] |= val;
                
                return true;
            }
            
            case 0x40c0: { // move from sr
                this.log("> move from sr");
                let val = this.registers[SR] | this.registers[CCR];
                
                if(effectiveAddress & 0b111000) {
                    // Memory
                    let addr = this.addressEa(val, 2);
                    this.emu.readMemory(addr);
                    this.emu.writeMemory(addr, val);
                    this.time += 4;
                }else{
                    // Register
                    this.registers[effectiveAddress] &= 0xffff0000;
                    this.registers[effectiveAddress] |= val;
                    this.time += 2;
                }
                return true;
            }
            
            case 0x46c0: { // move to sr
                this.log("> move to sr");
                if(this.mode != SUPER) {
                    this.trap(EX_PRIV_VIO);
                }else{
                    let val = this.readEa(effectiveAddress, 2);
                    
                    this.registers[CCR] = val & 0x00ff;
                    this.registers[SR] = val & 0xff00;
                    this.changeMode((val & S) ? SUPER : USER);
                    this.time += 8;
                }
                return true;
            }
            
            case 0xf800: { // nbcd
                this.log("> nbcd");
                console.error("NBCD not supported yet");
                return false;
            }
            
            case 0x4a00:
            case 0x4a40:
            case 0x4a80: { // tst
                let length = 1;
                if(noEffectiveAddress == 0x4a40) {
                    length = 2;
                }else if(noEffectiveAddress == 0x4a80) {
                    length = 4;
                }
                
                let val = this.readEa(effectiveAddress, length);
                
                this.log("> tst"+lengthString(length) + " "+this.eaStr(effectiveAddress, length, oldPc));
                
                let ccr = this.registers[CCR] & X;
                ccr |= val == 0 ? Z : 0;
                ccr |= isNegative(val, length) ? N : 0;
                this.registers[CCR] = ccr;
                return true;
            }
            
            case 0x4ac0: { // tas
                this.log("> tas");
                
                if(effectiveAddress & 0b111000) {
                    // Memory
                    this.time += 6;
                    let addr = this.addressEa(effectiveAddress, 1);
                    
                    let val = this.emu.readMemory8(addr);
                    
                    let ccr = this.registers[CCR] & X;
                    ccr |= val == 0 ? Z : 0;
                    ccr |= isNegative(val, 1) ? N : 0;
                    this.registers[CCR] = ccr;
                    
                    val |= 0x80;
                    this.emu.writeMemory8(addr, val);
                }else{
                    // Register
                    let ccr = this.registers[CCR] & X;
                    ccr |= (this.registers[effectiveAddress] & 0xff) == 0 ? Z : 0;
                    ccr |= isNegative(this.registers[effectiveAddress] & 0xff, 1) ? N : 0;
                    this.registers[CCR] = ccr;
                    
                    this.registers[effectiveAddress] |= 0x80;
                }
                
                
                return true;
            }
            
            case 0x4ec0: { // jmp
                this.log("> jmp");
                
                this.registers[PC] = this.addressEa(effectiveAddress, 4);
                this.time += 4;
                return true;
            }
            
            case 0x4e80: { // jsr
                this.log("> jsr");
                let addr = this.addressEa(effectiveAddress, 4);
                
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
                this.log("> andi to ccr");
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
                this.log("> ori to ccr");
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
                this.log("> andi to ccr");
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
            this.log("> andi/eori/ori to SR");
            let op = this.pcAndAdvance(2);
            if(this.mode != SUPER) {
                this.trap(EX_PRIV_VIO);
            }else{
                let val = this.registers[SR] | this.registers[CCR];
                
                switch(instruction) {
                    case 0x027c: val &= tmp; break; // andi
                    case 0x0a7c: val ^= tmp; break; // eori
                    case 0x007c: val |= tmp; break; // ori;
                    default: console.error("andi/eori/ori... How did I get here?"); break;
                }
                
                this.registers[CCR] = val & 0x00ff;
                this.registers[SR] = val & 0xff00;
                this.changeMode((val & S) ? SUPER : USER);
                this.time += 16;
            }
            return true;
        }
        
        if((instruction & 0xf1f0) == 0xc100) { // abcd
            this.log("> abcd");
            console.error("ABCD opcode not yet supported.");
            return false;
        }
        
        if((instruction & 0xf000) == 0xd000) { // add/adda
            this.log("> add/adda");
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
                let ea = makeSigned(this.readEa(effectiveAddress, length), length);
                
                this.registers[register] += ea;
            }else{
                // < ea > + Dn -> Dn / < ea >
                let eaAddr = 0;
                let ea = 0;
                if(opmode & 0b100) {
                    // Destination is address
                    eaAddr = this.addressEa(effectiveAddress, length);
                    ea = this.emu.readMemoryN(eaAddr, length);
                }else{
                    // Destination is register
                    ea = this.readEa(effectiveAddress, length);
                }
                
                let reg = this.registers[register] & lengthMask(length);
                tmp[0] = ea;
                tmp[0] += reg;
                
                this.registers[CCR] = addCcr(ea, reg, tmp[0], length);
                
                if(opmode & 0b100) {
                    // Destination is address
                    this.time += 4;
                    this.emu.writeMemoryN(eaAddr, tmp[0], length);
                }else{
                    // Destination is register
                    this.registers[register] &= ~lengthMask(length);
                    this.registers[register] |= tmp[0];
                }
            }
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0600
        || ((instruction & 0xf100) == 0x5000 && (instruction & 0x00c0) != 0x00c0)) { // addi/addq
            
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
                
                this.registers[effectiveAddress] &= ~lengthMask(length);
                this.registers[effectiveAddress] |= tmp[0];
            }else if((effectiveAddress & 0b111000) == 0b001000) {
                // To address register
                if(!q) {
                    console.error("Tried to add to an address register!");
                    return false;
                }
                this.time += 4;
                this.registers[effectiveAddress] += immediate;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress, length);
                let ea = this.emu.readMemoryN(addr, length);
                tmp[0] = ea;
                tmp[0] += immediate;
                
                if(q) {
                    this.time -= 8;
                }
                
                this.registers[CCR] = addCcr(immediate, ea, tmp[0], length);
                
                this.emu.writeMemoryN(addr, tmp[0], length);
            }
            
            if(q) {
                this.log("> addq"+lengthString(length)+
                    " #$"+immediate.toString(16)+","+this.eaStr(effectiveAddress, length, oldPc));
            }else{
                this.log("> addi"+lengthString(length)+
                    " #$"+immediate.toString(16)+","+this.eaStr(effectiveAddress, length, oldPc));
            }
            
            return true;
        }
        
        if((instruction & 0xf130) == 0xd100) { // addx
            this.log("> addx");
            console.error("ADDX opcode not yet supported.");
            return false;
        }
        
        if(((instruction & 0xf000) == 0xc000 || (instruction & 0xf100) == 0xb100 
        || (instruction & 0xf000) == 0x8000) && (instruction & 0x00c0) != 0x00c0) { // and/eor/or
            this.log("> and/eor/or");
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
                    ea = this.emu.readMemoryN(eaAddr, length);
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
                default: console.error("and/eor/or... How did I get here?");
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
                    return false;
                }
            }
            
            return true;
        }
        
        if(((instruction & 0xff00) == 0x0200 || (instruction & 0xff00) == 0x0a00
        || (instruction & 0xff00) == 0x0000)) { // andi/eori/ori
            this.log("> andi/eori/ori");
            let [length, immediate, tmp] = this.getImmediate(instruction);
            
            if((effectiveAddress & 0b111000) == 0b000000) {
                // To data register
                let reg = this.registers[effectiveAddress] & lengthMask(length);
                let val = immediate;
                
                switch(instruction & 0xff00) {
                    case 0x0200: val &= reg; break; // andi
                    case 0x0a00: val ^= reg; break; // eori
                    case 0x0000: val |= reg; break; // ori
                    default: console.error("andi/eori/ori... How did I get here?");
                }
                
                val &= lengthMask(length);
                
                this.registers[effectiveAddress] &= ~lengthMask(length);
                this.registers[effectiveAddress] |= val;
                
                let ccr = this.registers[CCR] & X;
                ccr |= isNegative(val, length) ? N : 0;
                ccr |= val == 0 ? Z : 0;
                this.registers[CCR] = ccr;
                
                if(length == 4) this.time += 4;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress, length);
                let ea = this.emu.readMemoryN(addr, length);
                tmp[0] = immediate;
                switch(instruction & 0xff00) {
                    case 0x0200: tmp[0] &= ea; break; // andi
                    case 0x0a00: tmp[0] ^= ea; break; // eori
                    case 0x0000: tmp[0] |= ea; break; // ori
                    default: console.error("andi/eori/ori... How did I get here?");
                }
                
                let ccr = this.registers[CCR] & X;
                ccr |= isNegative(tmp[0], length) ? N : 0;
                ccr |= (tmp[0]) == 0 ? Z : 0;
                this.registers[CCR] = ccr;
                
                this.time += 4;
                if(length == 4) this.time += 4;
                this.emu.writeMemoryN(addr, tmp[0], length);
            }
            
            return true;
        }
        
        if((instruction & 0xf010) == 0xe000 || (instruction & 0xfec0) == 0xe2c0) { // asl/asr/lsl/lsr
            this.log("> asl/asr/lsl/lsr");
            let size = (instruction >> 6) & 0b11;
            let register = (instruction & 0x0020) != 0;
            let logical;
            
            let [cr, left, length, regNo] = this.getShift(instruction);
            
            if(size == 0b11) {
                // Memory shift
                let addr = this.addressEa(effectiveAddress, 2);
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
                        val >>>= 1;
                    }else{
                        value = makeSigned(value, 2);
                        val >>= 1;
                    }
                }
                
                this.emu.writeMemory(addr, val);
                
                let ccr = 0;
                ccr |= xc ? (C | X) : 0;
                ccr |= isNegative(val, 2) ? N : 0;
                ccr |= (val & 0xffff) == 0 ? Z : 0;
                ccr |= (v && !logical) ? V : 0;
                this.registers[CCR] = ccr;
            }else{
                // Register shift
                logical = (instruction & 0b1000) != 0;
                
                this.time += 2 + (2 * cr);
                if(length == 4) this.time += 2;
                
                let value = this.registers[regNo] & lengthMask(length);
                let xc;
                let v;
                
                if(cr) {
                    if(left) {
                        xc = (value & (0x1 << ((length * 8) - 1) >>> (cr - 1))) != 0;
                        let vmask = lengthMask(length) & ~(lengthMask(length) >>> cr);
                        v = !((value & vmask) == vmask || (value & vmask) == 0);
                        value <<= cr;
                    }else{
                        // Right
                        xc = (value & (0x1 << (cr - 1))) != 0;
                        v = 0; // MSB never changes since it is propagated
                        if(logical) {
                            value >>>= cr;
                        }else{
                            value = makeSigned(value, length);
                            value >>= cr;
                        }
                    }
                    
                    this.registers[regNo] = (this.registers[regNo] & ~lengthMask(length)) | (value & lengthMask(length));
                    
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
            let chg = (instruction & 0x00c0) == 0x0040;
            let clr = (instruction & 0x00c0) == 0x0080;
            let set = (instruction & 0x00c0) == 0x00c0;
            
            let bitNo;
            let rstr = "";
            if(instruction & 0x0100) {
                // Register
                bitNo = this.registers[(instruction >> 9) & 0b111];
                rstr = "r"+((instruction >> 9) && 0b111);
            }else{
                // Immediate
                bitNo = this.pcAndAdvance(1);
                rstr = "#$"+bitNo.toString(16);
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
            
            let name = "btst";
            if(chg) {
                name = "bchg";
            }else if(clr) {
                name = "bclr";
            }else if(set) {
                name = "bset";
            }
            
            this.log("> "+name+" "+rstr+","+this.eaStr(effectiveAddress, 1, oldPc));
            
            return true;
        }
        
        if((instruction & 0xf0f8) == 0x50c8) { // dbcc
            let reg = instruction & 0b111;
            let condition = (instruction >> 8) & 0b1111;
            let displacement = this.pcAndAdvance(2);
            
            this.time += 6;
            
            this.log("> db"+conditionStr(condition) + " d" + reg + ",#$" + makeSigned(displacement, 2).toString(16));
            
            if(!doCondition(condition, this.registers[CCR])) {
                let newVal = makeSigned((this.registers[reg] & 0x0000ffff), 2) - 1;
                this.registers[reg] = (this.registers[reg] & 0xffff0000) | (newVal & 0x0000ffff);
                if(newVal != -1) {
                    this.registers[PC] = oldPc + makeSigned(displacement, 2) + 2;
                    this.log("Continuing loop to 0x" + this.registers[PC].toString(16));
                    this.time -= 4;
                }else{
                    this.time -= 2;
                }
            }
            
            return true;
        }
        
        if((instruction & 0xf1c0) == 0x4180) { // chk
            this.log("> chk");
            this.time += 6;
            let register = (instruction >> 9) & 0b111;
            let upper = makeSigned(this.readEa(effectiveAddress, 2), 2);
            let comp = makeSigned(this.registers[register] & lengthMask(2), 2);
            
            if(comp < 0 || comp > upper) {
                let ccr = this.registers[CCR] & X;
                ccr |= (comp < 0) ? N : 0;
                this.registers[CCR] = ccr;
                
                this.trap(EX_CHK);
            }
        }
        
        if((instruction & 0xff00) == 0x4200 && (instruction & 0x00c0) != 0x00c0) { // clr
            this.log("> clr");
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
            
            let ccr = this.registers[CCR] & X;
            ccr |= Z;
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xf000) == 0xb000) { // cmp/cmpa
            this.log("> cmp/cmpa");
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
                
                this.registers[CCR] = this.subCcr(reg, ea, tmp[0], length);
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
                
                this.registers[CCR] = this.subCcr(reg, ea, tmp[0], length);
            }
            
            return true;
        }
        
        if((instruction & 0xf138) == 0xb108) { // cmpm
            this.log("> cmpm");
            let src = instruction & 0b111;
            let dst = (instruction >> 9) & 0b111;
            let length = 0;
            let tmp;
            let sm;
            let dm;
            
            [length, tmp] = getOperandLength(instruction, true);
            
            sm = this.readEa(0b011000 & src, length);
            dm = this.readEa(0b011000 & dst, length);
            
            tmp[0] = dm;
            tmp[0] -= sm;
            
            this.registers[CCR] = this.subCcr(dm, sm, tmp[0], length, false);
            
            return true;
        }
        
        if((instruction & 0xff00) == 0x0c00) { // cmpi
            let [length, immediate, tmp] = this.getImmediate(instruction);
            
            if(length == 4 && (effectiveAddress & 0b111000) == 0) {
                this.time += 2;
            }
            
            let ea = this.readEa(effectiveAddress, length);
            tmp[0] = ea;
            tmp[0] -= immediate;
            
            this.registers[CCR] = this.subCcr(ea, immediate, tmp[0], length);
            
            this.log("> cmpi" + lengthString(length) +
                " #$"+immediate.toString(16) + "," + this.eaStr(effectiveAddress, length, oldPc));
            
            return true;
        }
        
        if((instruction & 0xf1c0) == 0x81c0) { // divs
            this.log("> divs");
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
            this.log("> divu");
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
            this.log("> exg");
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
        
        if((instruction & 0xffb8) == 0x4880) { // ext
            this.log("> ext");
            let reg = instruction & 0b111;
            let dat = 0;
            
            if(instruction & 0x0040) {
                // Word > long
                dat = makeSigned(this.registers[reg] & lengthMask(2), 2);
                this.registers[reg] = dat & lengthMask(4);
            }else{
                // Byte > word
                dat = makeSigned(this.registers[reg] & lengthMask(1), 1);
                this.registers[reg] &= ~lengthMask(2);
                this.registers[reg] |= dat & lengthMask(2);
            }
            
            let ccr = this.registers[CCR] & X;
            ccr |= dat == 0 ? Z : 0;
            ccr |= dat < 0 ? N : 0;
            this.registers[CCR] = ccr;
            return true;
        }
        
        if(instruction == 0x4afc) { // illegal
            this.log("> illegal");
            
            this.trap(EX_ILLEGAL);
            return true;
        }
        
        if((instruction & 0xf1c0) == 0x41c0) { // lea
            this.log("> lea");
            // TODO: Use only supported modes
            let reg = (instruction & 0x0e00) >>> 9;
            this.registers[ABASE + reg] = this.addressEa(effectiveAddress, 4);
            return true;
        }
        
        if((instruction & 0xfff8) == 0x4e50) { // link
            this.log("> link");
            let reg = (instruction & 0b111) + ABASE;
            let displacement = makeSigned(this.pcAndAdvance(2), 2);
            
            this.registers[SP] -= 4;
            this.emu.writeMemory(this.registers[SP], this.registers[reg], 4);
            this.registers[reg] = this.registers[SP];
            this.registers[SP] += displacement;
            return true;
        }
        
        if((instruction & 0xf100) == 0x7000) { // moveq
            let data = instruction & 0x00ff;
            let reg = (instruction >> 9) & 0b111;
            
            this.registers[reg] = makeSigned(data, 1);
            
            let ccr = this.registers[CCR] & X;
            ccr |= isNegative(this.registers[reg], 4) ? N : 0;
            ccr |= this.registers[reg] == 0 ? Z : 0;
            this.registers[CCR] = ccr;
            
            this.log("> moveq #$"+data.toString(16)+",d"+reg);
            
            return true;
        }
        
        if((instruction & 0xf038) == 0x008) { // movep
            this.log("> movep");
            console.error("MOVEP not supported");
        }
        
        if((instruction & 0xf1c0) == 0xc1c0) { // muls
            this.log("> muls");
            let register = (instruction >> 9) & 0b111;
            this.time += 66;
            
            let a = makeSigned(this.readEa(effectiveAddress, 2), 2);
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
            this.log("> mulu");
            let register = (instruction >> 9) & 0b111;
            this.time += 66;
            
            let a = this.readEa(effectiveAddress, 2);
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
            this.log("> move usp");
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
            this.log("> neg/negx");
            let [length, tmp] = getOperandLength(instruction, false);
            let x = (instruction & 0x0400) == 0;
            let xdec = (x && (this.registers[CCR] & X)) ? 1 : 0;
            
            tmp[0] = 0;
            if(effectiveAddress & 0b111000) {
                // Memory location
                let addr = this.addressEa(effectiveAddress, length);
                let val = this.emu.readMemoryN(addr, length);
                
                tmp[0] -= val;
                
                this.registers[CCR] = this.subCcr(0, val, tmp[0], length, true, x);
                
                tmp[0] -= xdec;
                
                this.emu.writeMemoryN(addr, tmp[0], length);
                this.time += 4;
                if(length == 4) this.time += 4;
            }else{
                // Register
                let val = this.registers[effectiveAddress] & lengthMask(length);
                
                tmp[0] -= val;
                
                this.registers[CCR] = this.subCcr(0, val, tmp[0], length, true, x);
                
                tmp[0] -= xdec;
                
                this.registers[effectiveAddress] &= ~lengthMask(length);
                this.registers[effectiveAddress] |= tmp[0];
                
                if(length == 4) this.time += 2;
            }
            
            return true;
        }
        
        if((instruction & 0xffc0) == 0x4840 && (instruction & 0x001c)) { // pea
            this.log("> pea");
            
            this.registers[SP] -= 4;
            this.emu.writeMemory32(this.registers[SP], this.addressEa(effectiveAddress, 4), 4);
            return true;
        }
        
        if((instruction & 0xf000) == 0x9000) { // sub/suba
            this.log("> sub/suba");
            let register = (instruction >> 9) & 0b111;
            let opmode = (instruction >> 6) & 0b111;
            let length = 0;
            let tmp;
            
            [length, tmp] = getOperandLength(instruction, true);
            
            // Do the math
            if((opmode & 0b011) == 0b011) {
                // < ea > - An -> An
                this.time += 4;
                register += ABASE;
                let ea = makeSigned(this.readEa(effectiveAddress, length), length);
                
                this.registers[register] -= ea;
            }else{
                // < ea > + Dn -> Dn / < ea >
                let eaAddr = 0;
                let ea = 0;
                let reg = this.registers[register] & lengthMask(length);
                
                if(opmode & 0b100) {
                    // < ea > - dn -> < ea >
                    eaAddr = this.addressEa(effectiveAddress, length);
                    ea = this.emu.readMemoryN(eaAddr, length);
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
            this.log("> subx");
            console.error("SUBX opcode not yet supported.");
            return false;
        }
        
        if((instruction & 0xff00) == 0x0400
        || ((instruction & 0xf100) == 0x5100 && (instruction & 0x00c0) != 0x00c0)) { // subi/subq
            let length = 0;
            let immediate = 0;
            let tmp;
            let q = (instruction & 0xf100) == 0x5100;
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
                    console.error("Tried to subtract from address register!");
                    return false;
                }
                this.time += 4;
                this.registers[effectiveAddress] -= immediate;
            }else{
                // To memory address
                let addr = this.addressEa(effectiveAddress, length);
                let ea = this.emu.readMemoryN(addr, length);
                tmp[0] = ea;
                tmp[0] -= immediate;
                
                if(q) {
                    this.time -= 8;
                }
                
                this.registers[CCR] = this.subCcr(ea, immediate, tmp[0], length, true);
                
                this.emu.writeMemoryN(addr, tmp[0], length);
            }
            
            if(q) {
                this.log("> subq"+lengthString(length)+
                    " #$"+immediate.toString(16)+","+this.eaStr(effectiveAddress, length, oldPc));
            }else{
                this.log("> subi"+lengthString(length)+
                    " #$"+immediate.toString(16)+","+this.eaStr(effectiveAddress, length, oldPc));
            }
            
            return true;
        }
        
        if(instruction == 0x4e71) { // nop
            this.log("> nop");
            return true;
        }
        
        if((instruction & 0xff00) == 0x4600) { // not
            this.log("> not");
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
            let condition = (instruction & 0x0f00) >>> 8;
            let displacement = instruction & 0x00ff;
            let bsr = condition == 0b001;
            
            if(displacement == 0x00) {
                displacement = this.pcAndAdvance(2);
                displacement = makeSigned(displacement, 2);
            }else{
                displacement = makeSigned(displacement, 1);
            }
            
            if(bsr) {
                this.log("> bsr #$" + displacement.toString(16));
            }else{
                this.log("> b"+conditionStr(condition) + " #$" + displacement.toString(16));
            }
            
            if(!condition || bsr || doCondition(condition, this.registers[CCR])) {
                if(bsr) {
                    this.registers[SP] -= 4;
                    this.emu.writeMemory32(this.registers[SP], this.registers[PC]);
                    this.time += 8;
                }else{
                    this.time += 2;
                }
                
                this.registers[PC] = oldPc + displacement + 2;
                
                this.log("Performing branch to 0x" + this.registers[PC].toString(16));
            }else{
                this.time += 4;
            }
            return true;
        }
        
        if((instruction & 0xc000) == 0x0000 && (instruction & 0x3000)) { // move/movea
            let length = 1;
            if((instruction & 0x3000) == 0x3000) {
                length = 2;
            }else if((instruction & 0x3000) == 0x2000) {
                length = 4;
            }
            
            let val = this.readEa(effectiveAddress, length);
            if(((instruction >> 6) & 0b111) == 0b001) {
                // movea
                val = makeSigned(val, length);
                let destReg = ((instruction >> 9) & 0b111);
                this.registers[ABASE + destReg] = val;
                this.log("> movea" + lengthString(length)
                    + " " + this.eaStr(effectiveAddress, length, oldPc)+",a"+destReg);
            }else{
                // move
                let ccr = this.registers[CCR] & X;
                ccr |= val == 0 ? Z : 0;
                ccr |= isNegative(val, length) ? N : 0;
                this.registers[CCR] = ccr;
                
                let destEa = (instruction & 0x0fc0) >>> 6;
                destEa = (destEa >>> 3) | ((destEa & 0b111) << 3);
                this.writeEa(destEa, val, length);
                this.log("> move" + lengthString(length)
                    + " " + this.eaStr(effectiveAddress, length, oldPc) + "," + this.eaStr(destEa, length, oldPc));
            }
            return true;
        }
        
        if((instruction & 0xff80) == 0x4c80 && (instruction & 0x001c)) { // movem (mem to register)
            this.log("> movem (to registers)");
            let length = 2;
            if(noEffectiveAddress == 0x4cc0) {
                length = 4;
            }
            
            if((effectiveAddress & 0b111000) == 0b000000 || (effectiveAddress & 0b111000) == 0b001000
            || (effectiveAddress & 0b111000) == 0b100000) {
                console.error("Invalid EA for movem to register");
                return false;
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
        
        if((instruction & 0xff80) == 0x4880 && (instruction & 0x001c)) { // movem (register to mem)
            this.log("> movem (to memory)");
            let length = 2;
            if(noEffectiveAddress == 0x48c0) {
                length = 4;
            }
            
            if((effectiveAddress & 0b111000) == 0b000000 || (effectiveAddress & 0b111000) == 0b001000
            || (effectiveAddress & 0b111000) == 0b011000) {
                console.error("Invalid EA for movem to memory");
                return false;
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
        
        if(instruction == 0x4e70) { // reset
            this.log("> reset");
            // Apparently this has no effect?
            return true;
        }
        
        if((instruction & 0xf018) == 0xe018) { // rol/ror (register)
            this.log("> rol/ror (register)");
            let [cr, left, length, regNo] = this.getShift(instruction);
            
            this.time += 2 + (2 * cr);
            if(length == 4) this.time += 2;
            
            let value = this.registers[regNo] & lengthMask(length);
            let tmp = 0;
            
            for(let i = 0; i < cr; i ++) {
                if(left) {
                    tmp = value >>> (length * 8 - 1);
                    value <<= 1;
                    value |= tmp;
                }else{
                    // Right
                    tmp = value & 0b1;
                    value >>>= 1;
                    value |= (tmp << (length * 8 - 1));
                }
            }
            
            this.registers[regNo] = (this.registers[regNo] & ~lengthMask(length)) | (value & lengthMask(length));
            
            let ccr = this.registers[CCR] & X;
            ccr |= tmp ? C : 0;
            ccr |= isNegative(value, length) ? N : 0;
            ccr |= value == 0 ? Z : 0;
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xfec0) == 0xe6c0) { // rol/ror (memory)
            this.log("> rol/ror (memory)");
            console.error("ROL/ROR with memory not implemented yet");
            return false;
        }
        
        if((instruction & 0xf018) == 0xe010) { // roxl/roxr (register)
            this.log("> roxl/roxr (register)");
            let [cr, left, length, regNo] = this.getShift(instruction);
            
            this.time += 2 + (2 * cr);
            if(length == 4) this.time += 2;
            
            let value = this.registers[regNo] & lengthMask(length);
            let tmp = 0;
            let tmp2 = 0;
            let x = (this.registers[CCR] & X) ? 1 : 0;
            
            for(let i = 0; i < cr; i ++) {
                if(left) {
                    tmp = x;
                    x = value >>> (length * 8 - 1);
                    value <<= 1;
                    value |= tmp;
                }else{
                    // Right
                    tmp = x;
                    x = value & 0b1;
                    value >>>= 1;
                    value |= (tmp << (length * 8 - 1));
                }
            }
            
            this.registers[regNo] = (this.registers[regNo] & ~lengthMask(length)) | (value & lengthMask(length));
            
            if(cr == 0) {
                let ccr = this.registers[CCR] & X;
                ccr |= ccr ? C : 0; // Set to the value of the extend bit
                ccr |= isNegative(value, length) ? N : 0;
                ccr |= value == 0 ? Z : 0;
                this.registers[CCR] = ccr;
            }else{
                let ccr = 0;
                ccr |= x ? (C | X) : 0;
                ccr |= isNegative(value, length) ? N : 0;
                ccr |= value == 0 ? Z : 0;
                this.registers[CCR] = ccr;
            }
            
            return true;
        }
        
        if((instruction & 0xfec0) == 0xe4c0) { // roxl/roxr (memory)
            this.log("> roxl/roxr (memory)");
            console.error("ROXL/ROXR with memory not implemented yet");
            return false;
        }
        
        if(instruction == 0x4e73) { // rte
            this.log("> rte");
            
            let sr = this.emu.readMemory(this.registers[SP]);
            this.registers[CCR] = sr & 0x00ff;
            this.registers[SR] = sr & 0xff00;
            this.registers[SP] += 2;
            
            this.registers[PC] = this.emu.readMemory32(this.registers[SP]);
            this.registers[SP] += 4;
            
            this.changeMode(sr & S ? SUPER : USER);
            this.time += 16;
            
            return true;
        }
        
        if(instruction == 0x4e77) { // rtr
            this.log("> rtr");
            
            this.time += 16;
            this.registers[CCR] = this.emu.readMemory(this.registers[SP]);
            this.registers[SP] += 2;
            this.registers[PC] = this.emu.readMemory32(this.registers[SP]);
            this.registers[SP] += 4;
            
            return true;
        }
        
        if(instruction == 0x4e75) { // rts
            this.log("> rts");
            
            this.time += 12;
            this.registers[PC] = this.emu.readMemory32(this.registers[SP]);
            this.registers[SP] += 4;
            
            return true;
        }
        
        if((instruction & 0xf1f0) == 0x8100) { // sbcd
            this.log("> sbcd");
            console.error("SBCD not implemented yet");
            return false;
        }
        
        if((instruction & 0xf0c0) == 0x50c0) { // scc
            this.log("> scc");
            
            let condition = (instruction & 0x0f00) >>> 8;
            
            if(effectiveAddress & 0b111000) {
                // Memory
                let addr = this.addressEa(effectiveAddress, 1);
                this.emu.readMemory8(addr, 1); // "A memory address is read before it is written"
                if(doCondition(condition, this.registers[CCR])) {
                    this.emu.writeMemory8(addr, 0xff, 1);
                }else{
                    this.emu.writeMemory8(addr, 0x00, 1);
                }
                this.time += 8;
            }else{
                // Register
                if(doCondition(condition, this.registers[CCR])) {
                    this.writeEa(effectiveAddress, 0xff, 1);
                    this.time += 2;
                }else{
                    this.writeEa(effectiveAddress, 0x00, 1);
                }
            }
            
            
            return true;
        }
        
        if(instruction == 0xfe72) { // stop
            this.log("> stop");
            
            console.error("STOP not implemented yet");
            this.pcAndAdvance(2);
            return false;
        }
        
        if((instruction & 0xfff8) == 0x4840) { // swap
            this.log("> swap");
            let reg = instruction & 0b111;
            
            let high = this.registers[reg] << 16;
            this.registers[reg] >>>= 16;
            this.registers[reg] |= high;
            
            let ccr = this.registers[CCR] & X;
            ccr |= this.registers[reg] == 0 ? Z : 0;
            ccr |= isNegative(this.registers[reg], 4) ? N : 0;
            this.registers[CCR] = ccr;
            
            return true;
        }
        
        if((instruction & 0xfff0) == 0x4e40) { // trap
            this.log("> trap");
            // TODO: Timing
            this.trap((instruction & 0x0f) + 32);
            
            return true;
        }
        
        if(instruction == 0x4e76) { // trapv
            this.log("> trapv");
            // TODO: Timing
            this.trap(EX_TRAPV);
            
            return true;
        }
        
        if((instruction & 0xfff8) == 0x4e58) { // unlk
            this.log("> unlk");
            this.time += 8;
            
            let reg = ABASE + (instruction & 0b111);
            
            this.registers[SP] = this.registers[reg];
            this.registers[reg] = this.emu.readMemory32(this.registers[SP]);
            this.registers[SP] += 4;
            
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
    
    updateSpans() {
        for(let i = 0; i <= 17; i ++) {
            document.querySelector("#r"+i).innerHTML = this.registers[i].toString(16);
        }
    }
}
