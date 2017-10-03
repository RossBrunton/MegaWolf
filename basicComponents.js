"use strict";

import {Component} from "./busses.js";

export class Ram extends Component {
    constructor(sizeOrBuffer) {
        super();
        if(sizeOrBuffer instanceof ArrayBuffer || sizeOrBuffer instanceof SharedArrayBuffer) {
            this._dv = new DataView(sizeOrBuffer);
        }else if(sizeOrBuffer instanceof DataView) {
            this._dv = sizeOrBuffer;
        }else{
            this._dv = new DataView(new ArrayBuffer(sizeOrBuffer));
        }
    }
    
    handleMemoryRead(bus, addr, length, littleEndian) {
        return this._dv[[0, "getUint8", "getUint16", 0, "getUint32"][length]](addr, littleEndian);
    }
    
    handleMemoryWrite(bus, addr, value, length, littleEndian) {
        this._dv[[0, "setUint8", "setUint16", 0, "setUint32"][length]](addr, value, littleEndian);
    }
};

export class SwappableRom extends Component {
    constructor(init) {
        super();
        if(init) this.swapRom(init);
    }
    
    swapRom(newRom) {
        this._dv = newRom;
        if(!(this._dv instanceof DataView)) {
            this._dv = new DataView(newRom);
        }
    }
    
    handleMemoryRead(bus, addr, length, littleEndian) {
        return this._dv[[0, "getUint8", "getUint16", 0, "getUint32"][length]](addr, littleEndian);
    }
    
    handleMemoryWrite(bus, addr, value, length, littleEndian) {
        this._dv[[0, "setUint8", "setUint16", 0, "setUint32"][length]](addr, value, littleEndian);
    }
};

export class BusBanker extends Component {
    constructor(emulator, targetBus, bankSize, initialBank) {
        super(emulator);
        this._bus = targetBus;
        this._bankSize = bankSize; // In bits
        this._bank = initialBank ? initialBank : 0;
        
        this._mask = (1 << bankSize) - 1;
        this._selector = 0;
        
        this.setBank(this._bank);
    }
    
    handleMemoryRead(bus, addr, length, littleEndian) {
        return this._bus.readMemory((addr & this._mask) | this._selector, length, littleEndian);
    }
    
    handleMemoryWrite(bus, addr, value, length, littleEndian) {
        this._bus.writeMemory((addr & this._mask) | this._selector, value, length, littleEndian);
    }
    
    setBank(bank) {
        this.selector = bank << this._bankSize;
    }
};

export class NullComponent extends Component {};
