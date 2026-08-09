import {useState} from 'react';
import {AddonButton, TextField, type TextFieldProps} from '@chameleon-labs/lattice-react';
import {Eye, EyeOff} from '@/screens/components/Icons';

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'addonEnd'>;

export const PasswordField = ({size = 'md', disabled = false, ...props}: PasswordFieldProps): React.JSX.Element => {
  const [revealed, setRevealed] = useState(false);
  const label = revealed ? 'Hide password' : 'Show password';
  const Icon = revealed ? EyeOff : Eye;

  return (
    <TextField
      {...props}
      size={size}
      disabled={disabled}
      type={revealed ? 'text' : 'password'}
      addonEnd={
        <AddonButton label={label} size={size} disabled={disabled} onClick={() => setRevealed((value) => !value)}>
          <Icon />
        </AddonButton>
      }
    />
  );
};
