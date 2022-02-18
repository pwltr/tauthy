import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { styled, css } from "@mui/material/styles";
import Fab from "@mui/material/Fab";
import AddIcon from "@mui/icons-material/Add";
import { Typography } from "@mui/material";

import type { VaultEntry } from "~/types";
import { generateTOTP, readStronghold } from "~/utils";
import { useInterval } from "~/hooks/useInterval";
import ProgressBar from "~/components/ProgressBar";
import List from "~/components/List";

export type ListEntry = VaultEntry & {
  token?: string;
};

const StyledProgressBar = styled(ProgressBar)<{ animate: boolean }>`
  position: fixed;
  top: 3.5rem;
  z-index: 1;

  ${(props) =>
    !props.animate &&
    css`
      animation: none;
    `}
`;

const StyledList = styled(List)`
  height: 400px;
  overflow: auto;
`;

const Container = styled("div")`
  display: flex;
  flex: 1;
  justify-content: center;
  align-items: center;
`;

const Button = styled(Fab)`
  position: fixed;
  bottom: 16px;
  /* check cross-platform scrollbar widths */
  right: 28px;
`;

const INTERVAL_FAST = 1000;
const INTERVAL_STANDARD = 30000;

const Main = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<ListEntry[]>([]);
  const [animate, setAnimate] = useState(true);
  const [delay, setDelay] = useState<number>(INTERVAL_FAST);

  const generateTokens = async (items: ListEntry[]) => {
    const promises = items.map((item) => generateTOTP(item.secret));
    const tokens = (await Promise.all(promises)) as string[];
    const itemsWithTokens = items.map((item, index) => ({
      ...item,
      token: tokens[index],
    }));

    if (!items[0]?.token) {
      setItems(itemsWithTokens);
    }

    if (items[0]?.token && items[0].token !== itemsWithTokens[0].token) {
      setItems(itemsWithTokens);
      reset();
    }
  };

  // get tokens on mount
  useEffect(() => {
    const getEntries = async () => {
      const entries = await readStronghold();
      const entriesJSON = JSON.parse(entries);
      // return entriesJSON;
      // const entries = getEntries();

      setItems(entriesJSON);
      generateTokens(entriesJSON);
    };

    getEntries();
  }, []);

  // and after specified delay
  useInterval(() => {
    generateTokens(items);
  }, delay);

  const reset = () => {
    // set normal interval
    setDelay(INTERVAL_STANDARD);
    // reset progressbar
    setAnimate(false);

    setTimeout(() => {
      setAnimate(true);
    }, 0);
  };

  return (
    <>
      {items.length > 0 && (
        <>
          <StyledProgressBar animate={animate} />
          <StyledList entries={items} />
        </>
      )}

      {items.length === 0 && (
        <Container>
          <Typography color="primary">
            Add an entry or import a backup
          </Typography>
        </Container>
      )}

      <Button
        aria-label="add"
        color="primary"
        size="medium"
        onClick={() => navigate("create")}
      >
        <AddIcon />
      </Button>
    </>
  );
};

export default Main;
