import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { styled, css } from "@mui/material/styles";
import Fab from "@mui/material/Fab";
import AddIcon from "@mui/icons-material/Add";
import { Typography } from "@mui/material";

import { generateTOTP } from "~/utils";
import useInterval from "~/hooks/useInterval";
import ProgressBar from "~/components/ProgressBar";
import List from "~/components/List";

export type Entry = {
  type: "totp";
  uuid: string;
  name: string;
  group: string;
  issuer: string;
  note: string;
  icon: string;
  icon_mime: "image/svg+xml";
  info: {
    secret: string;
    algo: "SHA1";
    digits: number;
    period: number;
  };
  token: string;
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

const Button = styled(Fab)`
  position: fixed;
  bottom: 16px;
  /* check cross-platform scrollbar widths */
  right: 28px;
`;

// const PERIOD = 30;

const Main = () => {
  const entries = localStorage.getItem("entries");
  const entriesJSON: Entry[] = entries ? JSON.parse(entries) : [];

  const navigate = useNavigate();
  const [items, setItems] = useState(entriesJSON);
  const [animate, setAnimate] = useState(true);
  const [delay, setDelay] = useState<number>(1000);

  const generateTokens = async (items: Entry[]) => {
    const promises = items.map((item) => generateTOTP(item.info.secret));
    const tokens = (await Promise.all(promises)) as string[];
    const itemsWithTokens = items.map((item, index) => ({
      ...item,
      // pad token with leading zeros
      token: String(tokens[index]).padStart(6, "0"),
    }));

    if (!items[0].token) {
      setItems(itemsWithTokens);
    }

    if (items[0].token && items[0].token !== itemsWithTokens[0].token) {
      setItems(itemsWithTokens);
      reset();
    }
  };

  // get tokens on mount
  useEffect(() => {
    generateTokens(items);
  }, []);

  // and after specified delay
  useInterval(() => {
    generateTokens(items);
  }, delay);

  const reset = () => {
    // set slow interval
    setDelay(30000);
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
        <Typography color="primary">Add an entry or import a backup</Typography>
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
