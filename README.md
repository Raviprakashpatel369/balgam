# Balgam Family Tree

Open `index.html` in any browser. No install, no server, no internet needed.

- **Tree view** – generations as rows, couples side by side. Drag to pan, scroll/pinch to zoom.
- **View modes** – whole family, or just the direct line / ancestors / descendants of the selected person.
- **Find relationship** – pick two people (or click two people on the tree). Gives the relationship both ways
  (1st cousin once removed, half-sister, daughter-in-law, stepmother, co-sister-in-law…), the common ancestor,
  the shortest chain, and highlights the path on the tree.
- **Edit** – add/edit/delete people, add parent/spouse/child/sibling in one click. Saved in the browser automatically.
- **Import / Export** – JSON backup, or CSV (`name, gender, born, died, place, father, mother, spouse, notes`;
  father/mother/spouse are the other person's name, several spouses separated by `;`).

`data.js` holds the starting data. It currently contains a made-up sample family, because `Balgam.pdf`
had no readable content. Replace it with the real family (or use Import), and set `demo: false`.

Files: `relations.js` (relationship logic), `layout.js` (tree layout), `app.js` (UI), `style.css`, `index.html`.
