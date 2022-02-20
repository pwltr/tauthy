import { styled } from "@mui/material/styles";
// import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";

import { getVault, getStatus, unlockVault, lockVault } from "~/utils";

const Container = styled("div")`
  background: #efefef;
  padding: 0.5rem 1rem;
  position: fixed;
  bottom: 1rem;
  left: 1rem;
`;

const Row = styled("div")`
  display: flex;
  grid-gap: 0.5rem;
`;

const Unlock = () => {
  const handleGetStatus = async () => {
    try {
      const status = await getStatus();
      console.log("status", status);
    } catch (err) {
      console.error(err);
    }
  };

  const handleGetVault = async () => {
    try {
      const currentVault = await getVault();
      console.log("currentVault", currentVault);
    } catch (err) {
      console.error(err);
    }
  };

  // const handleSubmit = async () => {
  //   try {
  //     await unlockVault(password);
  //     const currentVault = await getVault();
  //     console.log("currentVault", currentVault);
  //   } catch (err) {
  //     console.error(err);
  //   }
  // };

  return (
    <Container>
      {/* <TextField
        type="password"
        placeholder="Password"
        variant="filled"
        size="small"
        margin="normal"
        fullWidth
        autoFocus
        onChange={(event) => setPassword(event.target.value)}
      /> */}
      {/* <Button
        aria-label="add account"
        color="primary"
        size="small"
        variant="contained"
        onClick={handleSubmit}
      >
        Unlock Vault
      </Button> */}
      <Row>Vault</Row>
      <Row>
        <Button size="small" variant="contained" onClick={handleGetStatus}>
          Status
        </Button>
        <Button size="small" variant="contained" onClick={handleGetVault}>
          Value
        </Button>
      </Row>
      {/* <br />
      <Row>Password</Row>
      <Row>
        <Button size="small" variant="contained" onClick={handleGetStatus}>
          Status
        </Button>
        <Button size="small" variant="contained" onClick={handleGetVault}>
          Value
        </Button>
      </Row> */}
    </Container>
  );
};

export default Unlock;
