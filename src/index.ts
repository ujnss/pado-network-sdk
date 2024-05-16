import { createDataItemSigner } from "@permaweb/aoconnect";
import { encrypt, decrypt, keygen, THRESHOLD_2_3 } from "./algorithm";
import { nodes } from "./processes/noderegistry";
import { register as dataRegister, getDataById } from "./processes/dataregistry";
import { submit, getCompletedTasksById } from "./processes/tasks";
import { submitDataToAR, getDataFromAR } from "./padoarweave";
import { NODE_NAMES } from "./config";
export { transferAOCREDToTask } from './processes/utils';
import Arweave from 'arweave';


export interface PriceInfo {
  price: string;
  symbol?: string;
}

/**
* Encrypt data and upload data
*
* @param data - plain data need to encrypt and upload
* @param dataTag - the data meta info
* @param priceInfo - The data price symbol and price
* @param wallet - The ar wallet
* @param arweave - The ar object and default is ar production
* @returns The uploaded encrypted data id
*/
export const uploadData = async (data: Uint8Array, dataTag: any, priceInfo: PriceInfo,
  wallet: any, arweave: Arweave = Arweave.init({})): Promise<string> => {
  if (data.length === 0) {
    throw new Error("The Data to be uploaded can not be empty");
  }

  priceInfo.symbol = priceInfo.symbol || "PADO Token";

  let nodesres = await nodes();
  nodesres = JSON.parse(nodesres);
  if (nodesres.length < NODE_NAMES.length) {
    throw new Error(`nodesres.length:${nodesres.length} should greater equal NODE_NAMES.length:${NODE_NAMES.length}`);
  }

  let nodepks = Object();
  for (let i in nodesres) {
    let node = nodesres[i];
    nodepks[node.name] = node.publickey;
  }
  let nodesPublicKey = [];
  for (let i in NODE_NAMES) {
    //TODO: check whether exists
    nodesPublicKey.push(nodepks[NODE_NAMES[i]]);
  }

  const res = encrypt(nodesPublicKey, data);

  const transactionId = await submitDataToAR(arweave, res.enc_msg, wallet);

  const signer = createDataItemSigner(wallet);
  const encSksStr = JSON.stringify(res.enc_sks);
  // console.log('encSksStr', encSksStr);
  // console.log('res.nonce', res.nonce);
  const dataRes = await dataRegister(JSON.stringify(dataTag),
    JSON.stringify(priceInfo), encSksStr, res.nonce, transactionId, signer);

  // console.log('res.dataRes', dataRes);
  return dataRes;
}

/**
 * Generate key pair for encrypt/decrypt
 *
 * @returns The key-pair object
 */
export const generateKey = (): Promise<any> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(keygen());
    }, 1000);
  });
}

/*
export const listData = async () => {
  // 1. get data list from data process
  // 2. return dataTag, data ar url, data id, data price
  // let datas = await allData();
}*/


//TODO:
const taskType = "ZKLHEDataSharing";
const computeLimit = "9000000000000";
const memoryLimit = "512M";

/**
 * Submit a task to AO
 *
 * @param dataId - The data id
 * @param dataUserPk - The user's public key generated by keygen
 * @param wallet - The ar wallet
 * @returns The submited task id
 */
export const submitTask = async (dataId: string, dataUserPk: string, wallet: any): Promise<string> => {
  const signer = createDataItemSigner(wallet);
  let inputData = { ...THRESHOLD_2_3, dataId: dataId, consumerPk: dataUserPk };
  const taskId = await submit(taskType, dataId, JSON.stringify(inputData),
    computeLimit, memoryLimit, NODE_NAMES, signer);
  return taskId;
}

const getCompletedTaskPromise = (taskId: string, timeout: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = async () => {
      const timeGap = performance.now() - start;
      const taskStr = await getCompletedTasksById(taskId);
      const task = JSON.parse(taskStr);
      if (task.id) {
        resolve(taskStr);
      } else if (timeGap > timeout) {
        reject('timeout');
      } else {
        setTimeout(tick, 500);
      }
    };
    tick();
  });
};


/**
 * Get the result of the task
 * 
 * @param taskId The task id
 * @param dataUserSk - The user's secret key generated by keygen
 * @param arweave - The ar object and default is ar production
 * @param timeout Timeout in milliseconds (default: 10 seconds)
 * @returns The data
 */
export const getResult = async (taskId: string, dataUserSk: string,
  arweave: Arweave = Arweave.init({}), timeout: number = 10000) => {
  const taskStr = await getCompletedTaskPromise(taskId, timeout);
  const task = JSON.parse(taskStr);

  if (task.verificationError) {
    throw task.verificationError;
  }

  const chosenIndices = [1, 2];
  let reencSks = [];
  const computeNodes = JSON.parse(task.computeNodes);
  // console.log("computeNodes=", computeNodes);
  for (let nodeName of computeNodes) {
    const reencSksObj = JSON.parse(task.result[nodeName]);
    reencSks.push(reencSksObj.reenc_sk);
  }
  const reencChosenSks = [reencSks[0], reencSks[1]];

  let dataId = (JSON.parse(task.inputData)).dataId;
  let encData = await getDataById(dataId);
  encData = JSON.parse(encData);
  //console.log("getResult ar encData=", encData);
  const encMsg = await getDataFromAR(arweave, encData.encMsg);
  console.log("getResult ar enc_msg=", encMsg);
  const res = decrypt(reencChosenSks, dataUserSk, encData.nonce, encMsg, chosenIndices);
  return new Uint8Array(res.msg);
};



/**
 * Submit a task to AO and get the result. The combination of submitTask and getResult
 *
 * @param dataId - The data id
 * @param pk - The user's public key generated by keygen
 * @param sk - The user's secret key generated by keygen
 * @param wallet - The ar wallet
 * @param arweave - The ar object and default is ar production
 * @param timeout Timeout in milliseconds (default: 10 seconds)
 * @returns The data
 */
export const submitTaskAndGetResult = async (dataId: string, pk: string, sk: string, wallet: any,
  arweave: Arweave = Arweave.init({}), timeout: number = 10000) => {
  const taskId = await submitTask(dataId, pk, wallet);
  const result = await getResult(taskId, sk, arweave, timeout);
  return result;
}

