import {Badge, type BadgeVariant, VisuallyHidden} from '@chameleon-labs/lattice-react';
import './score-delta.css';

export type ScoreDeltaProps = {
  score: number;
  previousScore: number | null;
};

export const ScoreDelta = ({score, previousScore}: ScoreDeltaProps): React.JSX.Element => {
  if (previousScore === null) {
    return (
      <Badge className="score-delta">
        <VisuallyHidden>First completed score</VisuallyHidden>
        <span aria-hidden="true">First score</span>
      </Badge>
    );
  }

  const delta = score - previousScore;

  if (delta === 0) {
    return (
      <Badge className="score-delta">
        <VisuallyHidden>Score unchanged since the previous audit</VisuallyHidden>
        <span aria-hidden="true">No change</span>
      </Badge>
    );
  }

  const down = delta < 0;
  const magnitude = Math.abs(delta);
  const variant: BadgeVariant = down ? 'danger' : 'success';
  const label = `Score ${down ? 'down' : 'up'} ${magnitude} ${magnitude === 1 ? 'point' : 'points'} since the previous audit`;

  return (
    <Badge className="score-delta" variant={variant}>
      <VisuallyHidden>{label}</VisuallyHidden>
      <span aria-hidden="true">
        {down ? '↓' : '↑'} {magnitude}
      </span>
    </Badge>
  );
};
