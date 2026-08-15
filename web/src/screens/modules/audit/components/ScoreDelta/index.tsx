import {Badge, type BadgeVariant} from '@chameleon-labs/lattice-react';
import './score-delta.css';

export type ScoreDeltaProps = {
  score: number;
  previousScore: number | null;
};

export const ScoreDelta = ({score, previousScore}: ScoreDeltaProps): React.JSX.Element => {
  if (previousScore === null) {
    return (
      <Badge className="score-delta" aria-label="First completed score">
        First score
      </Badge>
    );
  }

  const delta = score - previousScore;

  if (delta === 0) {
    return (
      <Badge className="score-delta" aria-label="Score unchanged since the previous audit">
        No change
      </Badge>
    );
  }

  const down = delta < 0;
  const magnitude = Math.abs(delta);
  const variant: BadgeVariant = down ? 'danger' : 'success';
  const label = `Score ${down ? 'down' : 'up'} ${magnitude} ${magnitude === 1 ? 'point' : 'points'} since the previous audit`;

  return (
    <Badge className="score-delta" variant={variant} aria-label={label}>
      <span aria-hidden="true">
        {down ? '↓' : '↑'} {magnitude}
      </span>
    </Badge>
  );
};
