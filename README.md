# Campagne 2027

MOBA satirique en 3 contre 3 : gauche contre droite, avec des candidats à l’élection présidentielle 2027. Le but n’est pas de détruire le QG adverse mais de **conquérir l’Élysée** au centre de la carte. Le candidat du camp gagnant qui est le mieux placé dans les sondages est élu président de la République.

Ce jeu web tient en un seul dossier, en JavaScript et canvas, sans build ni dépendance.

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
| **Polémiques** | Les attaques des candidats sont des polémiques. Chaque coup fait baisser la cible dans les sondages au profit de l’attaquant. À 0 de crédibilité, c’est le scandale : retour au QG avec un délai, et une grosse perte dans les sondages. |
| **Sondage** | Le score de chaque candidat est sa part de l’influence totale, ramenée à 100 %. Il détermine sa **puissance** (dégâts et crédibilité). |
| **Mairies** | Immobilisent 10 s et rapportent des **parrainages**. Plus votre camp a vidé une mairie, plus elle rapporte. |
| **Meetings** | Immobilisent 10 s et rapportent des **dons**. |
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

- **Clic** : se déplacer, attaquer, ou entrer dans un camp de jungle.
- **Q W E R** : lancer un sort vers le curseur (**Maj** + touche pour viser d’abord).
- **B** : retour au QG.
- **P** : boutique.
- **S** : stop.
- **Espace** : caméra libre.
- **Molette** : zoom.
- **Échap** : pause.

## Structure

```
index.html      jeu (HUD + styles)
map.html        carte seule avec légende
src/data.js     réglages, candidats, objets
src/map.js      géométrie de la carte (voies, bureaux, objectifs, camps)
src/game.js     moteur de règles
src/ai.js       IA des candidats non joueurs
src/render.js   rendu canvas (carte, unités, mini-carte)
src/ui.js       menu, HUD, contrôles, boucle de jeu
```

Tous les équilibrages se règlent dans `CFG` (`src/data.js`).
