## MegaWolf - A JavaScript Mega Drive Emulator ##
This is still very early in development, pretty much the only thing it can run is Sonic the Hedgehog. And even then, not that well. It's very much in alpha.

It currently only supports the m68k and z80 CPUS, as well as the VDP. This means the audio chips are not implemented, so there is no sound.

### Usage ###
An index.html page is provided that should let you supply and run your own ROMs. The root folder needs to be served from a HTTP Server (`python -m SimpleHTTPServer` gives you one quickly). Then visit this server in a browser with JS module support (any modern non-IE one should have this).

### License ###
I'm not really sure what license I'll end up using for this, so for now I've released it under the GPLv3. I may make it more permissive at a later point.

### Thanks ###
Thanks to the people at http://info.sonicretro.org/ and https://emudocs.org/ for information about the system.
