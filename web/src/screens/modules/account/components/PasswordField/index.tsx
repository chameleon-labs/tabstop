import {useState} from 'react';
import {Button, TextField, type TextFieldProps} from '@chameleon-labs/lattice-react';
import {Eye, EyeOff} from '@/screens/components/Icons';

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'addonEnd'>;

export const PasswordField = ({size = 'md', ...props}: PasswordFieldProps): React.JSX.Element => {
  const [revealed, setRevealed] = useState(false);
  const label = revealed ? 'Hide password' : 'Show password';
  const Icon = revealed ? EyeOff : Eye;

  return (
    <TextField
      {...props}
      size={size}
      type={revealed ? 'text' : 'password'}
      addonEnd={
        <Button
          type="button"
          variant="ghost"
          size={size}
          aria-label={label}
          onClick={() => setRevealed((value) => !value)}
        >
          <Icon size="sm" />
        </Button>
      }
    />
  );
};
