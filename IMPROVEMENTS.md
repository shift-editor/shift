We are continuing with our migration to Electron whilst making QoL improvements to the overall design of the font editor.

* We want to move away from cavnas kit and move to 2d canvas. We also want to plan and think of a better abstraction for the renderer and a better pattern than brittle dirty flag setting.
* Currently, drawing beziers is broken, and moving points is also broken.
* we should consolidate tool patterns, and perhaps have more consolidated mouse handlers that dispatch to tools, but open to suggestions.
* tests that verify the common behaviours of our tools will make me more confident that they work.
* We should add proper linting and type checking as part of a pre-commit. I'd like to explore tsgo as a ts compiler as well as oxlint for linting for speed.
* The vector editing is very important so we want to make sure that is rock solid, tested, good abstraction patterns and good ergonomics. 

Lets pick these off and try get to a really good state. I want to merge the Electron migration this week, we should have vector editing back to where it was before. 