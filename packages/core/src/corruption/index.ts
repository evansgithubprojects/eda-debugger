export { analyze } from './analyze';
export { CorruptionEngine, type EngineOptions, type Observation } from './engine';
export { TaintTracker, defaultTaintOptions, type TaintOptions, type TaintSource } from './taint';
export { checkAgainstSamples, checkShapes } from './checks';
export { SuspectedCorruptionError } from './errors';
