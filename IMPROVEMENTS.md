* Turn the javascript generate code to be a typescript file please.
* I am unsure if the fontEngine should have managers as classes to dileneate it from its I/O ops (reading font files), from its editing operations.
* I don't see the point of the RustBridge. The FontEngine already wraps and the native module, I'd rather have dedicated managers that handle different areas of the API and expose them. And then all the actual TS editor object gets is maybe an interface of these different methods, or just gets the fontEngine directly. For instance the editor should not be "sending commands", the FontEngine can expose more high level methods and the editor just calls them. I think commands should be an internal thing to the engine which knows about the Rust side.
* We should not be trying to convert/map Contour type defined in TS and one in Rust. I believe the types should be generated from the Rust side and consumed in the TS side. Anything that lives in the Rust world should stay there. TS should only be worried about frontend things like rendering etc. We need a clean seperation there. For instance contourIDs and all that jazz stay in Rust.

So our biggest challenege currently is cleaning up the interop between the Rust side and TS side. This involves moving a lot of the TS side (which initially was the source of truth in the early days) to Rust cleanly. 

Don't over index on whats already here, we don't have to retro-fit we can blast things away and come up with new paradigms and patterns to make the design and architecture cleaner. 
* Manager patterns
* Clean abstractions
* Interfaces
* Strong and consistent typing (both in the Rust side and the TypeScript side)

This is important before we move on to more complex migrations. I need the pen tool to be working flawlessly, same with the other tools.
I should be able to at a minimum, create contours and have them render correctly (with the handles too), this my mean revisiting the renderer and seeing how it meshes with the new system.