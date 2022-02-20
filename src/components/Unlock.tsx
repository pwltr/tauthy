import { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { styled } from "@mui/material/styles";
import FormGroup from "@mui/material/FormGroup";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";

import { AppBarTitleContext } from "~/context";
import { getVault, unlockVault } from "~/utils";
import { Typography } from "@mui/material";

const Container = styled("div")`
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 4;
`;

const Unlock = () => {
  const navigate = useNavigate();
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setAppBarTitle("Unlock");
  }, []);

  const handleSubmit = async () => {
    try {
      await unlockVault(password);
      const currentVault = await getVault();
      console.log("currentVault", currentVault);
      navigate("/");
    } catch (err) {
      console.error(err);
      setError("Wrong password");
    }
  };

  return (
    <Container>
      <Typography variant="h4" color="primary">
        Vault locked.
      </Typography>
      <Typography variant="h5" color="primary">
        Enter "password" to unlock.
      </Typography>

      <FormGroup row>
        <TextField
          type="password"
          placeholder="Password"
          variant="filled"
          size="small"
          margin="normal"
          fullWidth
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && (
          <Typography variant="body2" color="primary">
            {error}
          </Typography>
        )}
      </FormGroup>
      <br />
      <Button
        aria-label="add account"
        color="primary"
        size="medium"
        variant="contained"
        onClick={handleSubmit}
      >
        Unlock
      </Button>
    </Container>
  );
};

export default Unlock;
