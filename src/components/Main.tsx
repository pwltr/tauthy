import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { styled, css } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Fab from "@mui/material/Fab";
import AddIcon from "@mui/icons-material/Add";

import { generateTOTP } from "~/utils";
import ProgressBar from "./ProgressBar";
import List from "./List";
import { Typography } from "@mui/material";

function usePrevious(value: string) {
  const ref = useRef<string>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

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
  const prevToken = usePrevious(items.length > 0 ? items[0].token : "");

  const generateTokens = async () => {
    console.info("generating tokens...");

    const promises = items.map((item) => generateTOTP(item.info.secret));
    const tokens = (await Promise.all(promises)) as string[];

    const itemsWithTokens = items.map((item, index) => ({
      ...item,
      token: tokens[index],
    }));

    if (itemsWithTokens[0].token !== items[0].token) {
      setItems(itemsWithTokens);
    }
  };

  useEffect(() => {
    generateTokens();

    const tokenInterval = setInterval(generateTokens, 1000);

    return () => {
      clearInterval(tokenInterval);
    };
  }, []);

  useEffect(() => {
    if (items.length > 0) {
      if (prevToken !== items[0].token) {
        console.log("resetting animation");
        setAnimate(false);

        setTimeout(() => {
          setAnimate(true);
        }, 1000);
      }
    }
  }, [items]);

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
