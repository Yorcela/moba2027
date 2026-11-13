# Campagne 2027

MOBA satirique en 3 contre 3 : gauche contre droite, avec des candidats à l’élection présidentielle 2027. Le but n’est pas de détruire le QG adverse mais de **conquérir l’Élysée** au centre de la carte. Le candidat du camp gagnant qui est le mieux placé dans les sondages est élu président de la République.

Ce jeu web en 3D (Three.js r128, chargé depuis cdnjs) tient en un seul dossier, sans build. Les candidats y sont des caricatures à grosse tête, construites en volumes simples, sans aucune photo.

![Candidats](docs/candidats.jpg)

## Lancer le jeu

Ouvrez `index.html` dans un navigateur. Pour voir la carte seule avec sa légende, ouvrez `map.html`. Pour passer par un serveur local :

```bash
python3 -m http.server 8127 --directory .
```

puis ouvrez http://localhost:8127.

## La carte

![Carte](docs/carte.jpg)

- La ville est un **cercle** coupé en **6 quartiers** par 3 avenues (Liberté, Égalité, Fraternité). Un boulevard circulaire en fait le tour.
- Les **QG de campagne** sont à l’ouest (gauche) et à l’est (droite).
- Il y a **3 voies de militants**, comme dans un MOBA classique :
  - **Avenue de la Liberté** (voie centrale) : QG, puis 3 bureaux de vote, puis l’**Élysée**.
  - **Boulevard nord** : QG, puis 2 bureaux de vote, puis l’**Assemblée nationale**.
  - **Boulevard sud** : QG, puis 2 bureaux de vote, puis le **Sénat**.
- La **jungle** (les quartiers) contient une **mairie** et un **meeting** par quartier. Les quartiers du nord et du sud sont neutres.

![Partie](docs/partie.jpg)

## Règles (v1)

| Mécanique | Fonctionnement |
|---|---|
| **Militants** | Une vague par voie toutes les 22 s. Chaque militant porte un bulletin. Les vagues grossissent au fil de la partie. |
| **Bureaux de vote** | 6 bulletins adverses suffisent à conquérir un bureau, et la conquête est définitive (comme une tourelle détruite). Un bureau tire sur les candidats adverses, jamais sur les militants. |
| **Objectifs** | Une voie s’ouvre quand tous les bureaux adverses de cette voie sont conquis. Les militants votent alors à l’objectif. Chaque objectif a une jauge commune à remplir, et les deux camps peuvent voter dans la même jauge, chacun la tirant vers soi. |
| **Assemblée nationale** | 10 bulletins donnent la majorité, qui renforce les militants du camp de 25 %. |
| **Sénat** | 10 bulletins donnent la majorité, qui rapporte des parrainages et des dons en continu. |
| **Élysée** | 16 bulletins font gagner la partie. |
| **Second tour** | À 15:00, chaque bulletin compte double. |
| **Conversion** | Un candidat qui met KO un militant adverse le « convertit » : le militant rentre chez lui sans voter, et le candidat gagne des dons et des points de sondage. |
| **Polémiques** | Les attaques des candidats sont des polémiques, lancées sous forme de **phylactères** (« Honte ! », « Démission ! »…). Les sorts sont des bulles pleines aux couleurs du camp. Chaque coup fait baisser la cible dans les sondages au profit de l’attaquant. À 0 de crédibilité, c’est le scandale : retour au QG avec un délai, et 15 % de son score perdu. |
| **Sondage** | Tout le monde part de **0 %** : les 100 % sont d’abord des **indécis**. Conversions, bulletins, bureaux conquis et mairies font gagner des indécis, de plus en plus difficilement à mesure qu’il en reste peu. Polémiques et scandales font passer des points d’un candidat à l’autre. Le score détermine la **puissance** (dégâts et crédibilité). |
| **Sorts** | Ils se débloquent dans les sondages : **A à 5 %**, **Z à 10 %**, **E à 15 %**, **R à 30 %**. Un sort débloqué le reste. |
| **Mairies** | Rapportent des **parrainages** (et du sondage). Plus votre camp a vidé une mairie, plus elle rapporte. |
| **Meetings** | Rapportent des **dons**. |
| **Récolte** | Il faut rester **immobile** : 12 s de son côté de la carte, 7 s du côté adverse, 10 s dans les quartiers neutres. Bouger annule la récolte, qui repart de zéro. |
| **Boutique** | Accessible au QG. On y achète du matériel de campagne : des objets personnels (porte-voix, bus, media training…) et des améliorations pour les militants (tracts, banderoles, baskets). |
| **Fin de partie** | Le premier camp à remplir la jauge de l’Élysée gagne. À 25:00, si personne n’a gagné, le scrutin est clos et c’est la jauge de l’Élysée qui départage les camps. Le candidat le mieux placé dans les sondages du camp gagnant est élu. |

## Candidats v1

| Gauche | Droite | Rôle |
|---|---|---|
| Jean-Luc Mélenchon | Marine Le Pen | Tribun : dégâts de zone, voie centrale |
| Raphaël Glucksmann | Édouard Philippe | Tireur : dégâts à distance, voie sud |
| Marine Tondelier | Bruno Retailleau | Rempart : soutien ou contrôle, voie nord |

Les kits sont symétriques pour l’équilibre. Les rôles de rempart diffèrent : Tondelier soigne, Retailleau étourdit. Les candidats sont représentés par leurs initiales : le jeu ne contient aucune photo.

## Contrôles

Le jeu se joue entièrement au clavier ; la souris est facultative. Le menu propose deux modes de contrôle et trois niveaux de difficulté (Facile par défaut). La difficulté n'affecte que les candidats adverses contrôlés par l'IA : leurs dégâts, leur réactivité et la fréquence de leurs sorts.

| Action | Mode « Flèches » (par défaut) | Mode « ZQSD » |
|---|---|---|
| Se déplacer | flèches (ou clic) | ZQSD (WASD en QWERTY) ou flèches |
| Sorts | A Z E R en AZERTY (Q W E R en QWERTY) | 1 2 3 4 |

- **Attaques automatiques** : elles partent toutes seules, même en marchant, sur l'ennemi dans votre cercle de portée (jaune) : militants d'abord, puis candidats.
- **Sorts à visée automatique** : ils visent la cible verrouillée, sinon le candidat adverse le plus proche, sinon un militant. Le déplacement éclair part dans la direction des flèches enfoncées. **Maj + sort** vise à la souris.
- **Tab** : verrouiller le candidat adverse le plus proche (prioritaire pour les attaques et les sorts). **X** : libérer la cible.
- **Entrée** : récolter la mairie ou le meeting le plus proche.
- **B** : retour au QG. **P** : boutique, puis **1** à **9** pour acheter.
- **Espace** : caméra libre. **Molette** : zoom. **Échap** : pause.

Quand votre candidat est mis KO par un scandale, un grand compte à rebours s'affiche au centre de l'écran jusqu'à son retour. Le délai de retour de chaque candidat apparaît aussi dans le sondage.

## Structure

```
index.html      jeu (HUD + styles)
map.html        carte seule avec légende
src/data.js     réglages, candidats, objets
src/map.js      géométrie de la carte (voies, bureaux, objectifs, camps)
src/game.js     moteur de règles
src/ai.js       IA des candidats non joueurs
src/render.js   rendu 2D (texture du sol, carte de map.html, mini-carte)
src/render3d.js rendu 3D : ville, bâtiments, candidats caricaturés, militants
src/ui.js       menu, HUD, contrôles souris / clavier, surcouche, boucle de jeu
```

Tous les équilibrages se règlent dans `CFG` (`src/data.js`).
