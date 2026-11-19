// The first import of the entry: windows opening while the rest of the bundle
// evaluates and the library loads already go through the hub.
import { startWindows } from './delivery';

startWindows();
