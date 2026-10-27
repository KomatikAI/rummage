-- Rummage seed data (fictional demo only).
--
-- Every name here is made up: the sale, the PTA, the household labels and the items.
-- No real people, no real homes. Item descriptions are unbranded on purpose.
--
-- Location: Forest Park, St. Louis, Missouri (a large public municipal park).
-- Every household pin sits on a footpath or bike path inside the park, taken from
-- OpenStreetMap footway/cycleway geometry, and each one is at least ~700 m from the park
-- boundary. The public pins are moved 60 to 180 m by the households trigger, so they stay
-- inside the park too. Nothing is placed on a residential parcel.
--
-- Idempotent: fixed uuids and `on conflict do nothing`, so running it twice is a no-op.
--
-- PayPal merchant ids: the three linked households carry placeholders SANDBOX_SELLER_1..3.
-- After onboarding the three sandbox seller accounts, replace them with the real sandbox
-- merchant ids (merchantIdInPayPal), for example:
--
--   update public.households set merchant_id_in_paypal = '<sandbox merchant id 1>'
--    where id = 'b0000000-0000-4000-8000-000000000001';
--   update public.households set merchant_id_in_paypal = '<sandbox merchant id 2>'
--    where id = 'b0000000-0000-4000-8000-000000000002';
--   update public.households set merchant_id_in_paypal = '<sandbox merchant id 3>'
--    where id = 'b0000000-0000-4000-8000-000000000003';
--
-- Donations: the sale is a fundraiser (fundraiser_name is set). There is no
-- accepts_donations column to seed: public_sales.accepts_donations is computed as
-- `organizer_merchant_id is not null`, and both the cart's donation picker (canDonate)
-- and create-order's donation unit (buildCheckoutUnits) require fundraiser_name AND a
-- non-null organizer_merchant_id, because the unit cannot be built without a payee. The
-- merchant id starts null on purpose (a placeholder would make the organizer page show
-- PayPal as linked and send PayPal an unknown payee), so the picker appears as soon as
-- the organizer links PayPal in the spike, or after setting it by hand:
--
--   update public.sales set organizer_merchant_id = '<sandbox organizer merchant id>'
--    where id = 'a0000000-0000-4000-8000-000000000001';
--
-- Owner accounts are not seeded: sales.organizer_user_id and households.owner_user_id
-- stay null until a later script attaches the judges' sandbox accounts.

-- ---------------------------------------------------------------------------
-- Sale
-- ---------------------------------------------------------------------------

insert into public.sales (
  id, organizer_user_id, name, slug, description, sale_date, starts_at, ends_at,
  area_lng, area_lat, area_radius_m, fundraiser_name, organizer_merchant_id, status
) values (
  'a0000000-0000-4000-8000-000000000001',
  null,
  'Maple Street Elementary PTA Spring Rummage',
  'maple-street-pta-spring-rummage',
  'Six family tables along the paths of Forest Park. Browse everything on one map, pay every seller in one PayPal checkout, and pick up with your code. Part of every order can go to the Maple Street Elementary PTA (a fictional school for this demo).',
  date '2026-11-14', -- a Saturday
  time '08:00',
  time '14:00',
  -90.2847,
  38.6382,
  1200,
  'Maple Street Elementary PTA',
  null,
  'open'
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Households (3 linked to PayPal, 3 not yet)
-- ---------------------------------------------------------------------------

insert into public.households (
  id, sale_id, owner_user_id, label, exact_lng, exact_lat,
  merchant_id_in_paypal, paypal_status, paypal_checked_at
) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', null,
   'The Alvarez table', -90.28899, 38.63761, 'SANDBOX_SELLER_1', 'ready', now()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', null,
   'Oak corner', -90.28284, 38.63913, 'SANDBOX_SELLER_2', 'ready', now()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', null,
   'The Lindqvist stall', -90.28497, 38.64086, 'SANDBOX_SELLER_3', 'ready', now()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', null,
   'Two Sisters Swap', -90.27959, 38.63555, null, 'unlinked', null),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', null,
   'The Okafor bookshelf', -90.29009, 38.64104, null, 'unlinked', null),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', null,
   'Garage Gnomes', -90.29256, 38.64022, null, 'unlinked', null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Items (40). All listed except two sold and one cash_sold on The Alvarez table.
-- ---------------------------------------------------------------------------

insert into public.items (
  id, household_id, title, description, category, condition,
  price, price_low, price_high, price_reason, photo_path, status
) values
  -- The Alvarez table (linked)
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'Kids balance bike', 'Lightweight 12-inch balance bike with an adjustable seat. Tires hold air; a few scuffs on the frame.',
   'kids', 'good', 25.00, 20.00, 35.00, 'Balance bikes resell quickly; the scuffs keep it below the like-new range.',
   'seed/kids-balance-bike.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
   'Wooden play kitchen', 'Child-size wooden play kitchen with oven door, sink and two knobs that click. Some stickers on the side.',
   'kids', 'good', 40.00, 30.00, 55.00, 'Large wooden toys hold value; stickers and wear bring it to the middle of the range.',
   'seed/wooden-play-kitchen.jpg', 'sold'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001',
   '10-inch cast iron skillet', 'Seasoned 10-inch cast iron skillet. No cracks, cooks evenly, light surface rust wiped off.',
   'kitchen', 'good', 15.00, 10.00, 20.00, 'Cast iron lasts forever; unbranded skillets usually go for 10 to 20 dollars.',
   'seed/cast-iron-skillet.jpg', 'sold'),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001',
   'Nesting mixing bowls (set of 5)', 'Five stainless steel mixing bowls that nest together. Barely used.',
   'kitchen', 'like_new', 12.00, 8.00, 15.00, 'Complete set in like-new shape; new sets cost about three times this.',
   'seed/nesting-mixing-bowls.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001',
   'Family board game bundle (4 games)', 'Four family board games, all pieces counted. Boxes have worn corners.',
   'other', 'good', 15.00, 10.00, 20.00, 'Bundles move faster than single games; complete pieces support the price.',
   'seed/board-game-bundle.jpg', 'cash_sold'),
  ('c0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001',
   'Box of 30 picture books', 'Thirty hardcover and paperback picture books for ages 2 to 6. A few have names written inside.',
   'books', 'good', 20.00, 15.00, 25.00, 'Picture books sell for 50 cents to a dollar each at yard sales; a box is a convenience price.',
   'seed/picture-book-box.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001',
   'Toddler tricycle', 'Steel toddler tricycle with a push handle. Paint is faded and the bell is missing.',
   'kids', 'fair', 12.00, 8.00, 15.00, 'Works fine but shows its age; fair condition puts it at the low end.',
   'seed/toddler-tricycle.jpg', 'listed'),

  -- Oak corner (linked)
  ('c0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000002',
   'Solid oak side table', 'Solid oak side table with one drawer. Sturdy, small water ring on top.',
   'furniture', 'good', 45.00, 35.00, 60.00, 'Solid wood furniture is in demand; the water ring knocks a little off.',
   'seed/oak-side-table.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000002',
   'Bentwood rocking chair', 'Bentwood rocking chair with a woven cane seat. Rocks smoothly; the cane has one small tear.',
   'furniture', 'fair', 35.00, 25.00, 50.00, 'Classic style, but the cane tear means a repair; priced to move.',
   'seed/bentwood-rocking-chair.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000002',
   'Brass floor lamp', 'Brass-finish floor lamp, about five feet tall, with a linen shade. Works with a standard bulb.',
   'decor', 'good', 30.00, 20.00, 40.00, 'Working floor lamps usually sell for 20 to 40 dollars; the shade is clean.',
   'seed/brass-floor-lamp.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002',
   'Three framed botanical prints', 'Set of three matching botanical prints in thin wood frames, 11 by 14 inches.',
   'decor', 'like_new', 24.00, 15.00, 30.00, 'A matching set is worth more than single frames; glass and frames are unmarked.',
   'seed/framed-botanical-prints.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000002',
   'Garden hand tool set', 'Trowel, transplanter and hand rake with wooden handles. Clean and sharp.',
   'garden', 'good', 10.00, 8.00, 15.00, 'Small hand tools sell for a few dollars each; the set is priced together.',
   'seed/garden-hand-tools.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000002',
   'Six terracotta pots', 'Six terracotta pots from 4 to 10 inches, with saucers. One has a chipped rim.',
   'garden', 'good', 12.00, 8.00, 18.00, 'Terracotta is cheap new but heavy to haul home; the chip lowers it slightly.',
   'seed/terracotta-pots.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000002',
   'Woven throw blanket', 'Cotton woven throw, 50 by 60 inches, in cream and rust stripes. Washed once.',
   'decor', 'like_new', 15.00, 10.00, 20.00, 'Like-new textiles sell for about a third of retail.',
   'seed/woven-throw-blanket.jpg', 'listed'),

  -- The Lindqvist stall (linked)
  ('c0000000-0000-4000-8000-000000000015', 'b0000000-0000-4000-8000-000000000003',
   '18V cordless drill with two batteries', 'Cordless drill-driver with two batteries and a charger. Both batteries hold a charge.',
   'tools', 'good', 40.00, 30.00, 55.00, 'Working batteries are most of the value; two of them put it in the upper middle.',
   'seed/cordless-drill.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000016', 'b0000000-0000-4000-8000-000000000003',
   'Socket wrench set', 'Metric and inch socket set in a carry case. Two small sockets are missing.',
   'tools', 'good', 25.00, 18.00, 35.00, 'Complete sets fetch more; two missing pieces bring it down a bit.',
   'seed/socket-wrench-set.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000017', 'b0000000-0000-4000-8000-000000000003',
   '4-foot aluminum step ladder', 'Four-foot aluminum step ladder with a paint tray. Legs are straight, feet are intact.',
   'tools', 'good', 30.00, 20.00, 40.00, 'Ladders are always wanted; aluminum and intact feet support the price.',
   'seed/step-ladder.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000018', 'b0000000-0000-4000-8000-000000000003',
   'Pair of tennis rackets', 'Two adult tennis rackets with covers. Grips are worn and the strings are old.',
   'sports', 'fair', 15.00, 10.00, 20.00, 'They will need new grips and strings, so they sit at the low end.',
   'seed/tennis-rackets.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000019', 'b0000000-0000-4000-8000-000000000003',
   'Yoga mat with two foam blocks', 'Thick yoga mat with two foam blocks and a carry strap. Cleaned and rolled.',
   'sports', 'like_new', 12.00, 8.00, 15.00, 'Mats lose value fast once used; like-new with blocks is a fair middle.',
   'seed/yoga-mat-blocks.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000020', 'b0000000-0000-4000-8000-000000000003',
   'Folding camp chairs (pair)', 'Two folding camp chairs with cup holders and carry bags. No rips.',
   'sports', 'good', 20.00, 15.00, 25.00, 'A matching pair sells better than singles; fabric is intact.',
   'seed/folding-camp-chairs.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000003',
   'Pair of 10 lb dumbbells', 'Two 10-pound hex dumbbells with rubber coating.',
   'sports', 'good', 20.00, 15.00, 25.00, 'Used weights usually go for about a dollar a pound.',
   'seed/dumbbells-10lb.jpg', 'listed'),

  -- Two Sisters Swap (not linked yet)
  ('c0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000004',
   'Denim jacket, women''s medium', 'Classic denim jacket, women''s medium, medium wash. No stains.',
   'clothing', 'good', 18.00, 12.00, 25.00, 'Denim jackets hold up well; clean and no stains supports a mid price.',
   'seed/denim-jacket.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000004',
   'Wool winter coat, men''s large', 'Charcoal wool-blend overcoat, men''s large. All buttons present, lining intact.',
   'clothing', 'good', 35.00, 25.00, 45.00, 'Warm wool coats sell well before winter; intact lining keeps it mid-range.',
   'seed/wool-winter-coat.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000024', 'b0000000-0000-4000-8000-000000000004',
   'Kids rain boots, size 11', 'Rubber rain boots, toddler size 11, yellow. Worn a handful of times.',
   'clothing', 'like_new', 8.00, 5.00, 10.00, 'Kids outgrow boots fast, so nearly new pairs sell for a few dollars.',
   'seed/kids-rain-boots.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000025', 'b0000000-0000-4000-8000-000000000004',
   'Three leather belts', 'Three leather belts in brown and black, sizes 32 to 36. Some creasing at the buckle holes.',
   'clothing', 'fair', 9.00, 5.00, 12.00, 'Visible creasing lowers the price; three together is a small bundle deal.',
   'seed/leather-belts.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000026', 'b0000000-0000-4000-8000-000000000004',
   'Hand-knit scarves (3)', 'Three hand-knit wool scarves in green, gray and red.',
   'clothing', 'like_new', 12.00, 8.00, 15.00, 'Handmade pieces are popular at school sales; priced as a bundle.',
   'seed/hand-knit-scarves.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000027', 'b0000000-0000-4000-8000-000000000004',
   'Women''s hiking boots, size 8', 'Waterproof leather hiking boots, women''s size 8. Soles have plenty of tread left.',
   'clothing', 'good', 25.00, 18.00, 35.00, 'Good tread and waterproofing keep sturdy boots in demand.',
   'seed/hiking-boots.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000028', 'b0000000-0000-4000-8000-000000000004',
   'Canvas tote bags (4)', 'Four sturdy canvas tote bags, plain natural color.',
   'other', 'good', 8.00, 5.00, 10.00, 'Totes are handy but common; two dollars each.',
   'seed/canvas-tote-bags.jpg', 'listed'),

  -- The Okafor bookshelf (not linked yet)
  ('c0000000-0000-4000-8000-000000000029', 'b0000000-0000-4000-8000-000000000005',
   'Stack of 8 cookbooks', 'Eight cookbooks covering baking, weeknight dinners and grilling. A few splattered pages.',
   'books', 'good', 16.00, 10.00, 20.00, 'Cookbooks sell for one to three dollars each; splatters keep it modest.',
   'seed/cookbook-stack.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000030', 'b0000000-0000-4000-8000-000000000005',
   '20 mystery paperbacks', 'Twenty mystery and thriller paperbacks. Spines creased, all pages intact.',
   'books', 'good', 15.00, 10.00, 20.00, 'Paperbacks go for under a dollar each; a box of twenty is a bundle price.',
   'seed/mystery-paperbacks.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000005',
   'Large hardcover world atlas', 'Oversized hardcover world atlas with a dust jacket. Looks unread.',
   'books', 'like_new', 18.00, 12.00, 25.00, 'Large reference books keep value when the jacket and binding are clean.',
   'seed/hardcover-atlas.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000032', 'b0000000-0000-4000-8000-000000000005',
   'Five-shelf pine bookcase', 'Unfinished pine bookcase with five shelves, about six feet tall. One shelf pin is a replacement.',
   'furniture', 'good', 40.00, 30.00, 55.00, 'Solid pine shelving sells well; buyers need a car, which keeps it under 50.',
   'seed/pine-bookcase.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000033', 'b0000000-0000-4000-8000-000000000005',
   'Adjustable desk lamp', 'Swing-arm desk lamp with a clamp base. Works; one spring is a little stiff.',
   'electronics', 'good', 10.00, 6.00, 14.00, 'Desk lamps are plentiful at yard sales; working and clamp included.',
   'seed/desk-lamp.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000034', 'b0000000-0000-4000-8000-000000000005',
   'Crate of 25 vinyl records', 'Twenty-five jazz, soul and folk records in a wooden crate. Sleeves are worn; most discs play cleanly.',
   'other', 'good', 40.00, 25.00, 60.00, 'Records vary widely; worn sleeves and mixed titles put the crate mid-range.',
   'seed/vinyl-record-crate.jpg', 'listed'),

  -- Garage Gnomes (not linked yet)
  ('c0000000-0000-4000-8000-000000000035', 'b0000000-0000-4000-8000-000000000006',
   'Portable wireless speaker', 'Palm-size wireless speaker with a charging cable. Holds a charge for a few hours.',
   'electronics', 'good', 20.00, 12.00, 25.00, 'Small speakers lose value quickly; working battery keeps it mid-range.',
   'seed/wireless-speaker.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000036', 'b0000000-0000-4000-8000-000000000006',
   'DVD player with remote', 'Compact DVD player with remote and cables. Tested and working.',
   'electronics', 'good', 12.00, 8.00, 15.00, 'DVD players are common now; including the remote helps.',
   'seed/dvd-player.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000037', 'b0000000-0000-4000-8000-000000000006',
   'Digital kitchen scale', 'Flat digital kitchen scale, grams and ounces. New battery included.',
   'kitchen', 'like_new', 8.00, 5.00, 10.00, 'Inexpensive new, so even like-new ones sell for a few dollars.',
   'seed/kitchen-scale.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000038', 'b0000000-0000-4000-8000-000000000006',
   '6-quart slow cooker', 'Six-quart slow cooker with a glass lid and removable crock. Clean, no chips.',
   'kitchen', 'good', 18.00, 12.00, 25.00, 'Slow cookers are popular in fall; an unchipped crock supports the price.',
   'seed/slow-cooker.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000039', 'b0000000-0000-4000-8000-000000000006',
   'Ceramic garden gnome', 'Hand-painted ceramic garden gnome, about 12 inches tall. Paint a bit faded from the sun.',
   'garden', 'good', 6.00, 4.00, 10.00, 'Decorative garden pieces sell on charm; sun fading keeps it low.',
   'seed/ceramic-garden-gnome.jpg', 'listed'),
  ('c0000000-0000-4000-8000-000000000040', 'b0000000-0000-4000-8000-000000000006',
   'Two outdoor extension cords, 25 ft', 'Two 25-foot outdoor-rated extension cords. No cuts or exposed wire.',
   'tools', 'good', 14.00, 10.00, 18.00, 'Outdoor cords are useful and intact; about half the new price.',
   'seed/outdoor-extension-cords.jpg', 'listed')
on conflict do nothing;
