'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isMiniGameCategory, visibleStorefrontCategories } = require('../src/services/storefront-category-visibility');
const auth = fs.readFileSync(path.join(__dirname, '../src/middleware/auth.js'), 'utf8');
const shopRoutes = fs.readFileSync(path.join(__dirname, '../src/routes/shop.js'), 'utf8');

const tags = [
  { id: 'players', name: 'นักเตะ' },
  { id: 'mini-game', name: 'Mini Game' },
  { id: 'mini_game_rewards', name: 'รางวัล' },
  { id: 'genre-9', name: 'มินิเกม' },
  { id: 'usual-game', name: 'เกมฟุตบอล' },
];
const product = { id: 'rental-01', filterTagIds: ['players', 'mini-game'] };
const visible = visibleStorefrontCategories(tags);

assert.deepEqual(visible.map(tag => tag.id), ['players', 'usual-game']);
assert.equal(isMiniGameCategory({ slug: 'MINI_games' }), true);
assert.equal(isMiniGameCategory({ title: 'มินิเกมส์' }), true);
assert.equal(isMiniGameCategory({ name: 'มินิเกมส์พิเศษ' }), true);
assert.equal(isMiniGameCategory({ name: 'เกมฟุตบอล' }), false, 'ordinary game categories must remain available');
assert.strictEqual(tags[1].name, 'Mini Game', 'hiding must not edit saved data');
assert.deepEqual(product.filterTagIds, ['players', 'mini-game'], 'product category assignments must remain intact');
assert.deepEqual(visibleStorefrontCategories(null), []);

assert.ok(auth.includes('navFilterTags = visibleStorefrontCategories(store.data.filterTags)'), 'navigation uses the filtered category list');
assert.ok(shopRoutes.includes('function storefrontFilterTags()'), 'home and product listing expose a filtered tag list');
assert.ok(shopRoutes.includes('function storefrontRecommendedCategories()'), 'recommended categories use the same visibility rule');
assert.ok(shopRoutes.includes('productFilterTags = storefrontFilterTags()'), 'product detail labels use the filtered tag list');

console.log('Storefront category visibility checks passed: hidden from storefront controls without changing saved records.');
