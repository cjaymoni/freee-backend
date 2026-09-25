/**
 * DiceBear avatar used whenever a user has no uploaded image or supplied URL.
 * DiceBear picks the background, eyes, mouth and shape colour from these lists
 * based on the seed, so seeding by user id gives each user a different avatar
 * that stays the same across requests.
 */
const DICEBEAR_OPTIONS = new URLSearchParams({
  scale: '80',
  backgroundColor: '69d2e7,f1f4dc,f88c49,ffd5dc,ffdfbf,d1d4f9,b6e3f4',
  eyes: [
    ...[4, 5, 6, 7, 8, 9].flatMap((v) =>
      [10, 12, 14, 16].map((w) => `variant${v}W${w}`),
    ),
    'variant3W16',
  ].join(','),
  eyesColor: 'ffffff',
  mouth: 'variant1,variant2,variant3,variant4',
  mouthColor: 'ffffff',
  shapeColor: '0a5b83,1c799f,f88c49',
}).toString();

export const defaultAvatarUrl = (seed: string): string =>
  `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(seed)}&${DICEBEAR_OPTIONS}`;
