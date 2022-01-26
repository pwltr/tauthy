import { useEffect, useContext } from "react";
import { styled } from "@mui/material/styles";
import Box from "@mui/material/Box";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";

import { AppBarTitleContext } from "~/App";
// import { useElectron } from '/@/use/electron'

const Create = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext);

  useEffect(() => {
    setAppBarTitle("Add new entry");
  }, []);

  return (
    <Box
      sx={{
        position: "relative",
      }}
    >
      Create
      {/* <List entries={items} /> */}
      <FormGroup row>
        {/* <FormControlLabel
          control={<Checkbox checked={dense} onChange={(event) => setDense(event.target.checked)} />}
          label="Enable dense"
        /> */}
        {/* <FormControlLabel
          control={<Checkbox checked={secondary} onChange={(event) => setSecondary(event.target.checked)} />}
          label="Enable secondary text"
        /> */}
      </FormGroup>
    </Box>
  );
};

export default Create;
