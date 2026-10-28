// Preserve the existing broker rounding allowance; the guard only covers
// IEEE-754 representation error at the quantities being compared. Never round
// stored fills or allocate units that are absent from the selected entry lots.
const EPS = 1e-8;
function tolerance(...values) {
 return EPS + 4 * Number.EPSILON * Math.max(1,...values.filter(Number.isFinite).map(Math.abs));
}
function equal(a,b,...references) {
 return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance(a,b,...references);
}
function exceeds(a,b,...references) {
 return !equal(a,b,...references)&&a>b;
}
export { tolerance, equal, exceeds }
