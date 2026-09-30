// Registers every area's flexures in the shared table (src/fea/flexures.ts). One line per area: import its provider
// and push it. The test (tests/flexures.test.ts) imports this file, so a row added here is held to the rule.
import { dockFlexures } from './dockflex';
import { PROVIDERS } from './flexures';
import { boardProvider } from './boardflex';
import { rackProvider } from './rackflex';

/** The socket latch, the release rod's barb fingers and the tongue's crush ribs (src/fea/dockflex.ts). */
PROVIDERS.push({ area: 'dock', run: (o) => dockFlexures(o) });
PROVIDERS.push(boardProvider, rackProvider);
