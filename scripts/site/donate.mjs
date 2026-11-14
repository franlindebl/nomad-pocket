// Where donations go: the one place the landing page (build.mjs) and the deploy-time counter (donations.mjs)
// read them from. The README's "Support the project" section and .github/FUNDING.yml repeat them by hand:
// keep the three in step. A null hides that way of giving; with all three null the section disappears.
// After changing an address, regenerate its QR code (docs/RELEASE.md, "Donations") and rebuild the site.

export const DONATE = {
  // GitHub user whose Sponsors profile receives card payments (github.com/sponsors/<user>). Set it once
  // GitHub has approved the profile: until then the link is a 404.
  githubSponsors: null, // 'franlindebl'
  // Bitcoin address (bc1…). Used only for donations, so its history is exactly what was given.
  btc: 'bc1qnf8wfuuy4t4pjr0jhpa3dln2t94farapsazeaj',
  // Ethereum address (0x…), also for USDC. The counter reads Ethereum mainnet only: the same address
  // receives on Base, Arbitrum and the rest, but their public explorers sit behind bot challenges.
  eth: '0x34fb22461bC015d8cA09952Fff3BBa09ADD46120',
};

// Transactions the counter leaves out (lowercase hashes): the owner's own test transfers from Coinbase when the
// addresses were set up (2026-11-14), so the total is only what others gave.
export const EXCLUDE_TXS = new Set([
  '71af9e5cb3f334c9987706c8e218e37e44fde3416164886e634b797def3b29e1', // BTC test, 16,400 sats
  '0x328275748b27f7ed7b6b947ca74cd3a291b2b286e3b98b9c0ccbfe156ad87533', // ETH test, 0.00462065 ETH (internal, from Coinbase's contract)
]);

// The only USDC the counter adds up: Circle's contract on Ethereum. Anything else sent to the address
// (airdropped look-alike tokens, address-poisoning dust) is ignored.
export const USDC_ETHEREUM = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
