import { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import FormGroup from "@mui/material/FormGroup";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";

import { AppBarTitleContext } from "~/context";
import { createCode } from "~/utils";

const Create = () => {
  const navigate = useNavigate();
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [group, setGroup] = useState("");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    setAppBarTitle("Add new account");
  }, []);

  const handleSubmit = async () => {
    // TODO: validate
    // TODO: icon

    let entry = {
      name,
      secret,
      issuer,
      group,
      // icon,
    };

    try {
      await createCode(entry);
      navigate(-1);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Box p={4}>
      <FormGroup row>
        <TextField
          placeholder="Name"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          placeholder="Issuer"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setIssuer(event.target.value)}
        />
        <TextField
          placeholder="Group"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setGroup(event.target.value)}
        />
        <TextField
          placeholder="Secret"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setSecret(event.target.value)}
        />
      </FormGroup>

      {/* TODO: move this to AppBar */}
      <br />
      <Button
        aria-label="add account"
        color="secondary"
        size="medium"
        variant="contained"
        onClick={handleSubmit}
      >
        Add Account
      </Button>
    </Box>
  );
};

export default Create;
