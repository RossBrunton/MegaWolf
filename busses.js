"use strict";

export class Component {
    handleMemoryRead(bus, addr, length, littleEndian) {
        return 0;
    }
    
    handleMemoryWrite(bus, addr, value, length, littleEndian) {
        // Pass
    }
    
    handlePortRead(bus, port, length) {
        return 0;
    }
    
    handlePortWrite(bus, port, data, length) {
        // Pass
    }
    
    handleInterrupt(bus, source, vector) {
        // Pass
    }
    
    handleAdvanceTime(bus, time) {
        // Pass
    }
};


const _MB_COM = 0;
const _MB_TOP = 1;
const _MB_MASK = 2;
export class MemoryBus extends Component {
    constructor(emulator, children) {
        super();
        this._emulator = emulator;
        if(children) {
            this.setChildren(children);
        }
    }
    
    setChildren(children) {
        this._children = children;
    }
    
    readMemory(addr, length, littleEndian) {
        for(let c of this._children) {
            if(addr <= c[_MB_TOP]) {
                return c[_MB_COM].handleMemoryRead(this, addr & c[_MB_MASK], length, littleEndian);
            }
        }
        
        return 0;
    }
    
    writeMemory(addr, value, length, littleEndian) {
        for(let c of this._children) {
            if(addr <= c[_MB_TOP]) {
                c[_MB_COM].handleMemoryWrite(this, addr & c[_MB_MASK], value, length, littleEndian);
                return;
            }
        }
    }
    
    handleMemoryRead(bus, addr, length, littleEndian) {
        return this.readMemory(addr, length, littleEndian);
    }
    
    handleMemoryWrite(bus, addr, value, length, littleEndian) {
        this.writeMemory(addr, value, length, littleEndian);
    }
}


const _IO_COM = 0;
const _IO_TOP = 1;
export class IoBus extends Component {
    constructor(emulator, children) {
        super();
        this._emulator = emulator;
        this._children = children;
    }
    
    readPort(port, length) {
        for(let c of this._children) {
            if(port <= c[_IO_TOP]) {
                return c[_IO_COM].handlePortRead(this, port, length);
            }
        }
        
        return 0;
    }
    
    writePort(port, value, length) {
        for(let c of this._children) {
            if(addr <= c[_IO_TOP]) {
                c[_IO_COM].handleMemoryWrite(this, port, value, length);
                return;
            }
        }
    }
    
    handlePortRead(bus, port, length) {
        return this.readPort(port, length);
    }
    
    handlePortWrite(bus, port, value, length) {
        this.writePort(port, value, length);
    }
}

export class InterruptBus extends Component {
    constructor(emulator, children) {
        super();
        this._emulator = emulator;
        this._children = children;
    }
    
    sendInterrupt(source, vector) {
        for(let c of this._children) {
            c.handleInterrupt(this, source, vector);
        }
    }
    
    handleInterrupt(bus, source, vector) {
        this.sendInterrupt(source, vector);
    }
};

export class TimeBus {
    constructor(emulator, children) {
        this._emulator = emulator;
        this._children = children;
    }
    
    advanceTime(value) {
        for(let c of this._children) {
            c.handleAdvanceTime(this, value);
        }
    }
}
