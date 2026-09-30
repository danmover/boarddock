// Registers every area's flexures in the shared table (src/fea/flexures.ts). One line per area: import its provider
// and push it. The test (tests/flexures.test.ts) imports this file, so a row added here is held to the rule.
import { PROVIDERS } from './flexures';

void PROVIDERS;
