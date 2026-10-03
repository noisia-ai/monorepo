export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="app-route-bootstrap">
      <div className="app-route-bootstrap__bar"><span /><i /><b /></div>
      <div className="app-route-bootstrap__body"><aside /><main><span /><strong /><i /></main></div>
    </div>
  );
}
