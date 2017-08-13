"use strict";

import {Emulator} from "./emulator.js";

window.emulator = new Emulator({invalidOp:"crash"});

window.load = function() {
    let f = document.querySelector("input[type=file]").files[0];
    var r = new FileReader();

    r.onload = function(e) { 
        emulator.loadRom(r.result);
        emulator.start();
    }
    
    r.onerror = function(err) {
        console.error("Failed to load file: " + r.error.message);
    }

    r.readAsArrayBuffer(f);
}
