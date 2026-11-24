# Team Oak House: blueprint (everyone reads this)

We are upgrading our cobblestone base into a detailed OAK house. It stays on the same spot:
x 276-293, z 342-353. Floor y 64, walls y 65-68, roof y 69. There are 8 rooms (one each):
the 4 south rooms are between z 343-347 and the 4 north rooms are between z 349-352. The room columns are x 277-279, 281-283, 285-287 and 289-292.

`fill ... replace` swaps the blocks already there for the new block. You keep the cobble you remove.
Doors, chests, beds and torches are never touched. When you need materials, the base chest is the shared stockpile, so deposit extras there.

## Materials the team needs (roughly)
- ~600 oak_planks (craft 4 per oak_log, so ~150 oak_log). Lumber crew!
- ~24 oak_log for corner/edge pillars
- ~40 glass (smelt sand in a furnace)
- ~45 wool for 8 beds (3 wool + 3 planks each) and rugs (2 wool -> 3 carpet)

## Jobs and exact commands
1. **Pillars (Dot):**
   `fill oak_log 276 65 342 276 68 342 replace` and the same at (293,342), (276,353), (293,353), plus (280,342) (284,342) (288,342) (280,353) (284,353) (288,353)
2. **South + north outer walls (Claude = south, Cosmo = north):**
   `fill oak_planks 277 65 342 292 68 342 replace` and `fill oak_planks 277 65 353 292 68 353 replace`
3. **East + west walls (Dot):**
   `fill oak_planks 276 65 343 276 68 352 replace` and `fill oak_planks 293 65 343 293 68 352 replace`
4. **Windows (Echo), glass replaces wall:**
   - south: `fill glass 277 67 342 279 67 342 replace`, then the same for x 281-283, 285-287 and 289-292
   - north: the same at z 353
   - west: `fill glass 276 66 344 276 67 346 replace` and `fill glass 276 66 350 276 67 352 replace`
   - east: the same at x 293
5. **Inner walls (Gizmo):**
   - centre: `fill oak_planks 277 65 348 292 68 348 replace`
   - cross walls: `fill oak_planks 280 65 343 280 68 352 replace`, then the same at x 284 and x 288
6. **Roof (Gizmo + Cosmo):** `fill oak_planks 276 69 342 293 69 353 replace`. It's 216 blocks, so split it at x 284.
7. **Beds and rugs (Fizz):**
   - one `bed` per room, placed on the floor (y 65) against the centre wall: z 347 for south rooms, z 349 for north rooms
   - a 1x3 carpet runner down each room, for example `fill red_carpet 278 65 344 278 65 346`
   - colours: red, blue, green, cream, brown, purple
   - put a torch in each room
8. **Lumber crew (Ada + Bolt):** chop oak, craft oak_planks, and deliver to the chest and to whoever is building.

Talk in chat! Say what you're doing, ask for materials, and say "done" when your part is finished.

## 9. NEW: Floor (Claude, help welcome)
The inside floor is still grass/dirt. Replace it with planks:
`fill oak_planks 277 64 343 292 64 352 replace`. That's 160 blocks, so split it at x 284 if you're helping.

## 10. NEW: DOORS (Claude)
There is now an `oak_door` block (craft: 6 oak_planks -> 3 doors). You can walk through it. A doorway is 2 blocks tall:
- outer walls: `fill oak_door 278 65 342 278 66 342 replace`, the same at x 282, 286 and 290, then the same 4 at z 353
- inner walls: one door per room through the centre wall, e.g. `fill oak_door 278 65 348 278 66 348 replace`

## STATUS (Day 10)
Done: walls, roof, windows, 12 doors, floor, and 4 beds + 6 rugs + 4 torches.
LEFT:
- 4 more beds: 12 wool + 12 planks (Fizz places them; everyone else shears or hunts Fluffalos and gives wool to Fizz)
- rugs + torches in the 4 empty rooms
- a few east-wall and floor gaps (Claude)
EXTRAS (detail!): a lantern or torch on each pillar outside, a bookshelf in a room, a path of cobblestone to the front doors, and flowers by the windows.
