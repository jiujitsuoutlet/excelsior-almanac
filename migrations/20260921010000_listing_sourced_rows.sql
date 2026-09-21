-- Listing-sourced draft rows (founder ruling, 2026-09-20). Every Smoothcomp
-- EVENT page returns HTTP 403 to plain HTTP (proven live 2026-09-20 across
-- all six organizer aliases, honest UA and browser UA, from a home IP and
-- from Cloudflare's own egress). The LISTING pages return 200 and carry
-- title, dates, city, country and coordinates. The ruling: build drafts from
-- listing data only, and never fetch the event page.
--
-- That trade is only honest if the database records WHICH facts came from
-- where, so the console can show a reviewer that a listing-sourced row is
-- thinner than a detail-sourced one. These three columns are that record.
-- Additive.

-- Nothing about a source's terms review changes here; this is about what
-- shape of page a source's crawl is allowed to fetch at all. 'listing_only'
-- means exactly what it says: the listing page, and never a detail page.
ALTER TABLE sources ADD COLUMN crawl_mode TEXT NOT NULL DEFAULT 'listing_and_detail'
  CHECK (crawl_mode IN ('listing_only', 'listing_and_detail'));

-- 'scraped': the source page stated the state. 'derived': it did not, and the
-- state was reverse-matched from the event's own coordinates against the
-- places gazetteer below. A row whose state could NOT be established
-- confidently is never written at all (see scout/src/geo.js's border and
-- distance guards) -- there is no 'guessed', on purpose.
ALTER TABLE events ADD COLUMN state_source TEXT
  CHECK (state_source IS NULL OR state_source IN ('scraped', 'derived'));

-- 'live': a real 2xx from the registration URL itself. 'structural': the URL
-- is well-formed, https, and on an approved alias -- and nothing more,
-- because the host refuses us. The console must never render these two the
-- same (fail-closed law); a weaker check that LOOKS like a live one is worse
-- than no check, because it launders an unknown into a confirmation.
ALTER TABLE events ADD COLUMN link_check_method TEXT
  CHECK (link_check_method IS NULL OR link_check_method IN ('live', 'structural'));

-- The gazetteer, for deriving `state` from coordinates. Same source file and
-- same stable geoname_id keys as the app's own public.places import
-- (excelsior-master, scripts/import-geonames-places.mjs, GeoNames cities500,
-- CC BY 4.0), so the two sides agree by construction rather than by
-- coincidence: a state this crawl derives is a state the app's own gazetteer
-- would name for the same point.
CREATE TABLE places (
  geoname_id  INTEGER PRIMARY KEY,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 3 AND state = upper(state)),
  country     TEXT NOT NULL DEFAULT 'US' CHECK (length(country) = 2 AND country = upper(country)),
  lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
  population  INTEGER
);

-- The reverse match reads a small bounding box around one point, then does
-- exact haversine in code over the handful of rows that returns.
CREATE INDEX places_lat_lon ON places (lat, lon);
