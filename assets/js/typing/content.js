const words = `the be and of a in to have it that for you with on do say this they at but from we his she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been being through much before right too mean old same tell boy follow came show around form small set put end does another large must big such turn here why ask went men read need land different home move try kind hand picture again change off play spell air away animal house point page letter mother answer found study still learn should world high every near add food between own below country plant last school father keep tree never start city earth eye light thought head under story saw left few while along might close something seem next hard open example begin life always those both paper together got group often run important until children side feet car mile night walk white sea began grow took river four carry state once book hear stop without second late miss idea enough eat face watch far real almost let above girl sometimes mountain cut young talk soon list song leave family water rain stone green clear space quiet sound field window morning table road friend help write game code line word type quick slow bright blue fresh black round simple little music dream cloud room spring summer winter fall sleep warm cold north south east west`.split(' ');

export const lessons = [
  { id: 'home-keys', name: 'Home row · keys', finger: true, text: 'ff jj fj jf dd kk dk kd ss ll sl ls aa ;; a; ;a asdf jkl; asdf jkl; fj dk sl a;' },
  { id: 'home-words', name: 'Home row · words', finger: true, text: 'dad sad lad ask flask fall salad lads add all flags flask dad asks a lad; a lad asks dad;' },
  { id: 'top-row', name: 'Top row', finger: true, text: 'fr ju de ki sw lo aq p; red tree write quiet power your type read water road quite true' },
  { id: 'bottom-row', name: 'Bottom row', finger: true, text: 'fv jm dc k, sx l. az ;/ van mix box calm move next zoom brave climb music quick brown fox' },
  { id: 'numbers', name: 'Numbers', text: '12 34 56 78 90 21 43 65 87 09 120 345 678 901 2026 1440 360 1080 25 50 75 100' },
  { id: 'punctuation', name: 'Punctuation', text: "wait, what? yes, that works. keep going; take your time. it's a small test: words, commas, and a full stop." },
  { id: 'sentences', name: 'Sentences', text: 'The rain stopped before noon. A small bird landed on the open window. I put down my book and watched it fly away.' },
];

export function makeText(count, { punctuation = false, numbers = false } = {}, random = Math.random) {
  let previous = '';
  return Array.from({ length: count }, (_, i) => {
    let word = words[Math.floor(random() * words.length) % words.length];
    if (word === previous) word = words[(words.indexOf(word) + 1) % words.length];
    previous = word;
    if (numbers && i % 9 === 5) word = String(Math.floor(random() * 999));
    if (punctuation && i % 7 === 6) word += i % 2 ? '.' : ',';
    return word;
  }).join(' ');
}

export function fingerFor(character) {
  const groups = [
    ['qaz1', 'left little'], ['wsx2', 'left ring'], ['edc3', 'left middle'],
    ['rfvtgb45', 'left index'], ['yhnujm67', 'right index'], ['ik,8', 'right middle'],
    ['ol.9', 'right ring'], ['p;:/?0-=[]\'"', 'right little'], [' ', 'thumb'],
  ];
  return groups.find(([keys]) => keys.includes(character?.toLowerCase()))?.[1] || '';
}
