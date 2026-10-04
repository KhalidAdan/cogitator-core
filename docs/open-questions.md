# Open questions

The handoff ended with five questions for you. Two are answered by last night's work; three are still yours. Then the new ones.

## From the handoff

**1. Does the 11th edition Wahapedia export include points?** *Answered: yes.*
Per unit size, tiered by how many of the unit you take, plus enhancement costs. Details in [wahapedia.md](wahapedia.md#points-are-in-the-export-and-theyre-tiered). The text export is still used at import, because the roster file doesn't carry the enhancement's cost or the detachments, and the database can't know which you picked. Once a list is in, its points are checked against the database.

**2. Should the database and translations be shareable with friends, or private only?** *Still yours.*
Today it's one SQLite file on this machine, so it's private by construction. If you ever want to share, the split the handoff suggested still holds: stats, points and your translations are shareable; Games Workshop's verbatim text (the `wh_*` tables and the "official wording" on each rule) is not. The schema keeps them in separate tables and columns, so that split is available when you want it.

**3. Confirm the three low-confidence rules.** *Still yours.*
Close-Quarters versus other guns; "this unit" abilities spreading across an attached unit; Lethal Hits as optional when the weapon also has Devastating Wounds. The engine does what the POC did for all three. I hoped the export would settle them, but it doesn't: `Abilities.csv` holds unit abilities (Leader, Scouts, Deep Strike, the army rules), not the weapon abilities or the core rules, so there is still no rules source for these in the project. "This unit" is the one the database can help with: every leader ability's official wording is now beside its paraphrase in the rules library, so you can see case by case whether it says "this model" or "this unit".

**4. Should "Charged this turn" stay on by default?** *Still yours.*
I kept it on, as the POC had it. It's one line (`defaultOpts` in `app/domain/options.ts`). Since options are now stored per list, another route is to leave the default and switch it off on Cophasta, where it inflates the averages.

**5. Benchmark set: keep the Cogitator's 19, or add 11th edition staples and Character targets?** *Partly answered by a feature.*
The 19 are kept, because the calibration depends on them. But you can now add any datasheet as a target from its page in the database browser, so adding staples is a few clicks rather than a decision. Character targets still need the engine to understand a unit with a leader in it, which it doesn't.

## New

**6. Is the Space Marines codex newer than Wahapedia's data?** *Answered on 2 October: yes.*
You confirmed the codex numbers came out on 30 September. Wahapedia's export is stamped 28 September, and its live Lieutenant page still shows the old profile (Toughness 4, Oath of Moment), so the whole site is behind, not just the export. Cophasta's roster values are the right ones; leave "use the database's values" alone for that list until Wahapedia updates.

**7. Which price is right for the four Aeldari units?** *Answered on 2 October: your list's.*
Checked against the Munitorum Field Manual on Warhammer Community (Aeldari, v1.5). All four differences are points drops in v1.5 that Wahapedia, still on v1.4, doesn't have: Fire Dragons 120 → 110, Kharseth 85 → 80, Farseer 65 → 60, Shroud Runners (6) 175 → 165. Every unit and enhancement in *The Burning One and the Exile* (the imported v2, now the only built-in list) matches v1.5, so the list is 2,000 points.

**8. Should imports take the database's values by default?**
I left it off because of question 6 (decision D-12). Once you trust the database for a faction, you may want it on for that faction. Per-faction trust would be a small addition: a setting that says "for Aeldari, the database wins".

**9. What is Void Thieves now?**
The library has it as a Corsair Coterie rule. The export's Corsair Coterie has two detachment abilities and it isn't one of them. Renamed, moved onto datasheets, or gone.

**10. Where should this run so your phone can use it?** *Answered on 2 October: Cloudflare, at khld.dev/cogitator-core, with accounts (D-38, D-39).*
It's a Node server with a SQLite file. Your machine has Tailscale, so the least-effort answer is to run the production build here and open it over the tailnet. A small VPS or Fly.io with a volume would also work. I didn't set anything up, and there is no login, so it should not be exposed to the open internet as it stands.

**11. "Draft with Claude": do you want it, and on whose key?**
The roadmap's phase 4 was built around a claude.ai artifact capability that doesn't exist outside artifacts. Here it would be a server-side call to the Anthropic API with your key. The pieces it needs are in place (the effect schema validates what comes back; the rule editor is where the draft would land; the official wording to translate is one click away), so it's a contained piece of work once you decide.

**12. Keep the POC in the repo?**
`kill-ledger/` is what the parity tests compare against. I'd keep it until you've used the new app for a while, then drop the folder and the two parity tests together, keeping the calibration rows, which don't need it.

**13. Why do nine of Cophasta's prices differ from the Field Manual?** *Answered, 2 October: the Field Manual was updated that morning.*
The roster was exported before the v1.5 update, so it carries the previous points. The table below is the list against v1.5 as read on 2 October.

Checked against the Munitorum Field Manual, Space Marines v1.5. Eight units and all four enhancements match. Nine units don't, and the list's price sits on neither the old value nor the new one:

| Unit | In the list | Field Manual v1.5 |
|---|---:|---:|
| Bladeguard Ancient | 60 | 70 |
| Bladeguard Veteran Squad (6) | 170 | 180 |
| Outrider Squad (3), twice | 85 | 80 |
| Chaplain on Bike | 80 | 75 |
| Hellblaster Squad (10) | 220 | 230 |
| Assault Intercessor Squad (5) | 90 | 85 |
| Land Speeder | 110 | 105 |
| Storm Speeder Thunderstrike | 155 | 140 |

At Field Manual prices the list is 1,980, not 1,990. Possible causes: the roster was exported before v1.5, 40k.app uses the codex's printed points, or there is chapter pricing I didn't see (the page has a White Scars section, but it only listed the chapter's own characters). Not investigated further. You're fixing the list yourself, so the built-in copy has been removed from the app (decision D-27); import the corrected roster when it's ready.

**14. Should Astra Militarum Orders be modelled?** *Answered on 4 October: yes, unit by unit in the modifier bar (D-45).*
Voice of Command has no text in the roster file, so the importer doesn't flag it, but three Orders change damage: Take Aim! (+1 Ballistic Skill), Fix Bayonets! (+1 Weapon Skill) and First Rank, Fire! Second Rank, Fire! (+1 Attack on Rapid Fire weapons). An Order is a choice per unit, a bit like a mark that only one unit gets. Until then, the modifier bar's +1 to hit stands in for Take Aim! and Fix Bayonets!, and nothing for the extra attack. The new "Under an Order" switch (D-40) only drives rules that wait for an Order.
