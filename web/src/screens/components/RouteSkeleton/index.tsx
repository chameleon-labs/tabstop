import {useLocation} from 'react-router';
import {SKELETON_BLOCKS, skeletonShapeFor} from './shapes';
import './route-skeleton.css';

export {skeletonShapeFor} from './shapes';
export type {SkeletonShape} from './shapes';

const block = (name: string, index: number): React.JSX.Element => (
  <span key={`${name}-${String(index)}`} className="route-skeleton__block" data-block={name} />
);

export const RouteSkeleton = (): React.JSX.Element => {
  const shape = skeletonShapeFor(useLocation().pathname);
  const {head, body} = SKELETON_BLOCKS[shape];

  return (
    <div className="route-skeleton" data-shape={shape} aria-busy="true">
      <p className="visually-hidden">Loading…</p>
      <div className="route-skeleton__blocks" aria-hidden="true">
        <span className="route-skeleton__head">{head.map(block)}</span>
        {body.map(block)}
      </div>
    </div>
  );
};
