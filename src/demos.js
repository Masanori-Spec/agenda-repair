/** All agendas, places, equipment and session names below are synthetic. */
const session = (id, title, start, duration, roomId, options = {}) => ({
  id, title, start, duration, roomId,
  earliestStart: 540, latestStart: 780 - duration,
  eligibleRoomIds: ['hall', 'studio', 'lab'], resourceIds: [], pinned: false,
  ...options,
});
const base = (title, sessions, blackouts) => ({
  version: 1, title,
  day: { start: 540, end: 780, step: 15 },
  rooms: [
    { id: 'hall', label: 'ホール' },
    { id: 'studio', label: 'スタジオ' },
    { id: 'lab', label: 'ラボ' },
  ],
  resources: [
    { id: 'projector', label: '移動式プロジェクター' },
    { id: 'camera', label: '撮影キット' },
  ],
  sessions, blackouts,
});

export const DEMOS = [
  {
    id: 'room-closure',
    label: '会場が使えない',
    description: '架空のものづくり体験会。10:00〜11:00のスタジオ閉鎖を、開始時刻と会場の変更を抑えて修復します。',
    problem: base('架空デモ · ものづくり体験会', [
      session('welcome', 'オープニング', 540, 30, 'hall', { earliestStart: 540, latestStart: 540, eligibleRoomIds: ['hall'], pinned: true }),
      session('story', 'アイデアの伝え方', 570, 45, 'studio', { earliestStart: 570, latestStart: 600, eligibleRoomIds: ['studio', 'hall'], resourceIds: ['projector'] }),
      session('prototype', '紙で試作品をつくる', 600, 45, 'lab', { earliestStart: 570, latestStart: 675, eligibleRoomIds: ['studio', 'lab'] }),
      session('photo', '試作品の撮影', 615, 30, 'studio', { earliestStart: 600, latestStart: 690, eligibleRoomIds: ['studio', 'lab'], resourceIds: ['camera'] }),
      session('review', 'レビューと改善', 660, 45, 'hall', { earliestStart: 630, latestStart: 705, eligibleRoomIds: ['hall', 'studio'], resourceIds: ['projector'] }),
      session('closing', '共有タイム', 735, 30, 'hall', { earliestStart: 735, latestStart: 735, eligibleRoomIds: ['hall'], pinned: true }),
    ], [{ id: 'studio-service', type: 'room', targetId: 'studio', start: 600, end: 660 }]),
  },
  {
    id: 'equipment-blackout',
    label: '共有機材が止まる',
    description: '架空の動画制作ワークショップ。カメラ点検中は撮影できません。別室でも同じ機材は同時に使えません。',
    problem: base('架空デモ · 動画制作ワークショップ', [
      session('brief', '制作の説明', 540, 30, 'hall', { earliestStart: 540, latestStart: 540, eligibleRoomIds: ['hall'], pinned: true }),
      session('capture', '商品カット撮影', 570, 45, 'studio', { earliestStart: 570, latestStart: 675, eligibleRoomIds: ['studio', 'lab'], resourceIds: ['camera'] }),
      session('interview', 'インタビュー撮影', 615, 45, 'lab', { earliestStart: 585, latestStart: 690, eligibleRoomIds: ['studio', 'lab'], resourceIds: ['camera'] }),
      session('edit', '編集の基本', 600, 45, 'hall', { earliestStart: 570, latestStart: 690, eligibleRoomIds: ['hall', 'studio'], resourceIds: ['projector'] }),
      session('color', '色と明るさの調整', 660, 30, 'hall', { earliestStart: 600, latestStart: 705, eligibleRoomIds: ['hall', 'lab'], resourceIds: ['projector'] }),
      session('showcase', '上映会', 735, 45, 'hall', { earliestStart: 735, latestStart: 735, eligibleRoomIds: ['hall'], resourceIds: ['projector'], pinned: true }),
    ], [{ id: 'camera-inspection', type: 'resource', targetId: 'camera', start: 570, end: 630 }]),
  },
  {
    id: 'pinned-obstruction',
    label: '固定条件と衝突',
    description: '架空の展示準備会。固定した実演がラボ閉鎖と重なります。固定を解除するか、閉鎖条件を見直す必要があります。',
    problem: base('架空デモ · 固定条件で修復できない例', [
      session('intro', '準備の説明', 540, 30, 'hall', { earliestStart: 540, latestStart: 540, eligibleRoomIds: ['hall'], pinned: true }),
      session('demo', '装置の実演', 600, 45, 'lab', { earliestStart: 570, latestStart: 675, eligibleRoomIds: ['lab', 'studio'], pinned: true }),
      session('labels', '展示ラベルの確認', 585, 30, 'studio', { earliestStart: 570, latestStart: 660, eligibleRoomIds: ['studio', 'hall'] }),
      session('walkthrough', '会場の見学', 675, 45, 'hall', { earliestStart: 645, latestStart: 720, eligibleRoomIds: ['hall', 'studio'] }),
    ], [{ id: 'lab-safety-check', type: 'room', targetId: 'lab', start: 590, end: 650 }]),
  },
];
